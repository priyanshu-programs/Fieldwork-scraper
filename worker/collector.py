"""Collect pages with Scrapling's own fetchers."""
import re
import time
import uuid
from collections import deque
from datetime import datetime, timezone
from urllib.parse import urljoin, urlsplit, urlunsplit

RETRY_STATUSES = (429, 500, 502, 503, 504)
MAX_PAGES = 25
MAX_PAGE_MARKDOWN = 500_000
MAX_RUN_BYTES = 10_000_000


def canonical(url):
    u = urlsplit(url)
    out = urlunsplit((u.scheme.lower(), u.netloc.lower(), u.path or '/', u.query, ''))
    # Keep an empty '?' like the app's URL parser does, so pages-mode uploads match run.urls.
    return out + '?' if not u.query and url.split('#', 1)[0].endswith('?') else out


def public_url(url):
    """Same rule as publicUrl in src/lib/validation.ts. The app refuses page records that break it."""
    if len(url) > 2048:
        return False
    try:
        u = urlsplit(url)
        port = u.port
    except ValueError:
        return False
    host = (u.hostname or '').lower().rstrip('.')  # 'localhost.' is localhost
    return (u.scheme in ('http', 'https') and not u.username and not u.password
            and port in (None, 80, 443) and host != 'localhost'
            and not host.endswith(('.localhost', '.local', '.internal'))
            and '.' in host and ':' not in host and not re.fullmatch(r'\d+(\.\d+){3}', host))


def utf16_cut(text, limit):
    """Cut text to `limit` UTF-16 code units, the unit the app's length limits count."""
    if len(text.encode('utf-16-le')) <= 2 * limit:
        return text
    out, used = [], 0
    for ch in text:
        used += 2 if ord(ch) > 0xFFFF else 1
        if used > limit:
            break
        out.append(ch)
    return ''.join(out)


def open_session(browser=False, chrome_path=None):
    """One Scrapling session per job, so a crawl reuses one browser or connection pool."""
    if browser:
        from scrapling.fetchers import StealthySession
        options = {'headless': True, 'solve_cloudflare': True, 'network_idle': True}
        if chrome_path:
            options['executable_path'] = chrome_path
        return StealthySession(**options)
    from scrapling.fetchers import FetcherSession
    return FetcherSession(impersonate='chrome')


def header(headers, name):
    for k, v in (headers or {}).items():
        if k.lower() == name:
            return str(v)
    return ''


class Collector:
    def __init__(self, browser=False, chrome_path=None, session_factory=None):
        self.browser = browser
        self.chrome_path = chrome_path
        self.session_factory = session_factory or open_session
        self.session = None
        self.limit_error = None
        self.on_progress = lambda stage, url: None

    def fetch(self, url):
        return self.session.fetch(url) if self.browser else self.session.get(url)

    def one(self, url, parent):
        self.on_progress('fetching', url)
        record = {'id':str(uuid.uuid4()), 'url':canonical(url), 'final_url':None, 'parent_url':parent, 'title':'', 'status':'failed', 'error':None, 'markdown':'', 'collected_at':datetime.now(timezone.utc).isoformat()}
        links = []
        try:
            for attempt in range(3):
                page = self.fetch(url)
                if page.status in RETRY_STATUSES and attempt < 2:
                    self.on_progress('retrying', url)
                    time.sleep(2 ** (attempt + 1))
                    continue
                break
            final = canonical(str(page.url or url))
            if not public_url(final):
                raise ValueError('The page redirected to an address Fieldwork does not collect (private, IP-only, custom port or over 2048 characters).')
            record['final_url'] = final
            if page.status < 200 or page.status >= 300:
                hint = ' The site may need a browser; retry in Browser mode.' if not self.browser and page.status in (403, 503) else ''
                raise ValueError(f'HTTP {page.status}.{hint}' if hint else f'HTTP {page.status}')
            kind = header(page.headers, 'content-type').lower()
            if kind and not any(k in kind for k in ('text/html', 'application/xhtml+xml')):
                record.update(status='unsupported', error='Only HTML pages are supported.')
                return record, []
            record['title'] = utf16_cut(str(page.css('title::text').get() or '').strip(), 500)
            self.on_progress('cleaning', url)
            markdown = page.markdown(main_content_only=True)
            if len(markdown.encode('utf8')) > MAX_PAGE_MARKDOWN:
                record.update(status='limit', error='Page exceeds 500 KB of Markdown.')
            else:
                record.update(status='success', markdown=markdown)
                links = [urljoin(final, str(link)) for link in page.css('a::attr(href)').getall()]
        except Exception as e:
            # Do not log arbitrary response bodies or request secrets.
            record['error'] = utf16_cut(str(e) or type(e).__name__, 2000)
        return record, links

    def collect(self, job, should_stop=lambda:False):
        with self.session_factory(self.browser, self.chrome_path) as session:
            self.session = session
            try:
                yield from self._collect(job, should_stop)
            finally:
                self.session = None

    def _collect(self, job, should_stop):
        crawl = job['mode'] == 'crawl'
        host = urlsplit(job['urls'][0]).netloc.lower() if crawl else None
        queue = deque((canonical(u), None, 0) for u in job['urls'])
        seen = set(); total = 0
        self.limit_error = None
        while queue and len(seen) < MAX_PAGES and not should_stop():
            url, parent, depth = queue.popleft()
            if url in seen:continue
            seen.add(url)
            record, links = self.one(url, parent)
            total += len(record['markdown'].encode('utf8'))
            if total > MAX_RUN_BYTES:
                record.update(status='limit', error='Run exceeds 10 MB.', markdown='')
                self.limit_error = 'Collection stopped at the 10 MB content limit.'
            yield record
            if total > MAX_RUN_BYTES:break
            if crawl and depth < 2:
                for link in links:
                    u = urlsplit(link)
                    if u.scheme in ('http','https') and u.netloc.lower() == host and public_url(canonical(link)):
                        link = canonical(link)
                        if link not in seen and len(queue) < 500:
                            queue.append((link, url, depth + 1))
        if len(seen) >= MAX_PAGES and any(u not in seen for u, _, _ in queue):
            self.limit_error = 'Collection stopped at 25 pages. More links remain on the site.'
