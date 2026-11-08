import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path
from scrapling.engines.toolbelt.custom import Response
import httpx
from worker.collector import Collector, canonical, open_session, public_url
from worker.main import Spool, LeaseExpired, run

PAGE = b'<html><title>Test</title><body><h1>Evidence</h1><a href="/second">Next</a><a href="https://other.example/a">Outside</a></body></html>'


def response(url, status=200, body=PAGE, kind='text/html'):
    return Response(url=url, content=body, status=status, reason='', cookies={}, headers={'Content-Type':kind}, request_headers={}, _log=False)


class FakeSession:
    def __init__(self, statuses=None):
        self.requests = []; self.statuses = list(statuses or []); self.closed = False
    def __enter__(self):return self
    def __exit__(self, *a):self.closed = True
    def get(self, url):
        self.requests.append(url)
        return response(url, self.statuses.pop(0) if self.statuses else 200)
    fetch = get


def collector(session, browser=False):
    return Collector(browser=browser, session_factory=lambda b, c: session)


class SessionTests(unittest.TestCase):
    def test_http_mode_uses_scrapling_fetcher_session(self):
        with patch('scrapling.fetchers.FetcherSession') as fs:
            open_session(False)
        fs.assert_called_once_with(impersonate='chrome')
    def test_browser_mode_uses_stealthy_session_with_cloudflare(self):
        with patch('scrapling.fetchers.StealthySession') as ss:
            open_session(True, 'C:/chrome.exe')
        ss.assert_called_once_with(headless=True, solve_cloudflare=True, network_idle=True, executable_path='C:/chrome.exe')
    def test_one_session_per_job_and_closed(self):
        s = FakeSession(); list(collector(s).collect({'mode':'crawl','urls':['https://example.com/']}))
        self.assertEqual(len(s.requests), 2); self.assertTrue(s.closed)
    def test_browser_mode_calls_fetch(self):
        s = FakeSession(); s.get = None
        result = list(collector(s, browser=True).collect({'mode':'pages','urls':['https://example.com/']}))
        self.assertEqual(result[0]['status'], 'success')


class CollectionTests(unittest.TestCase):
    def test_direct_pages_dedupe_and_markdown(self):
        result = list(collector(FakeSession()).collect({'mode':'pages','urls':['https://example.com/','https://example.com/']}))
        self.assertEqual(len(result), 1); self.assertEqual(result[0]['status'], 'success')
        self.assertIn('Evidence', result[0]['markdown']); self.assertEqual(result[0]['title'], 'Test')
    def test_crawl_scope(self):
        result = list(collector(FakeSession()).collect({'mode':'crawl','urls':['https://example.com/']}))
        self.assertEqual(len(result), 2); self.assertTrue(all('other.example' not in p['url'] for p in result))
    def test_retry_then_http_error(self):
        with patch('time.sleep'):
            ok, _ = collector(FakeSession([503])).collect({'mode':'pages','urls':['https://example.com/']}).__next__(), None
            bad = list(collector(FakeSession([503, 503, 503])).collect({'mode':'pages','urls':['https://example.com/']}))[0]
        self.assertEqual(ok['status'], 'success'); self.assertIn('HTTP 503', bad['error']); self.assertIn('Browser mode', bad['error'])
    def test_non_html_unsupported(self):
        s = FakeSession(); s.get = lambda url: response(url, kind='application/pdf')
        self.assertEqual(list(collector(s).collect({'mode':'pages','urls':['https://example.com/a.pdf']}))[0]['status'], 'unsupported')
    def test_page_limit(self):
        c = collector(FakeSession())
        c.one = lambda url, parent: ({'id':url,'url':url,'markdown':'','status':'success'}, ['https://example.com/'+str(i) for i in range(60)])
        self.assertEqual(len(list(c.collect({'mode':'crawl','urls':['https://example.com/']}))), 25)


class SpoolTests(unittest.TestCase):
    def test_upload_recovery_and_expiry_preserve_files(self):
        class Offline:
            def send(self,*args):raise ConnectionError()
        class Expired:
            def send(self,*args):raise LeaseExpired()
        class Online:
            def send(self,*args):return {'ok':True}
        with tempfile.TemporaryDirectory() as folder:
            s=Spool(folder);s.save('page',{'data':'saved'},'001')
            with self.assertRaises(ConnectionError):s.flush(Offline())
            self.assertTrue((Path(folder)/'001.json').exists());s.flush(Online());self.assertFalse((Path(folder)/'001.json').exists())
            s.save('page',{'data':'saved'},'002');s.flush(Expired());self.assertTrue((Path(folder)/'expired'/'002.json').exists())

    def test_refused_upload_moves_aside_and_later_records_still_send(self):
        # One record the app always refuses must not block the spool or later claims.
        sent = []
        class Refuses:
            def __init__(self, status):self.status = status
            def send(self, route, payload):
                if payload.get('bad'):
                    request = httpx.Request('POST', 'http://127.0.0.1:3000/api/worker/page')
                    raise httpx.HTTPStatusError('refused', request=request, response=httpx.Response(self.status, request=request))
                sent.append(payload);return {'ok':True}
        with tempfile.TemporaryDirectory() as folder:
            s=Spool(folder);s.save('page',{'bad':True},'001');s.save('finish',{'ok':True},'002')
            s.flush(Refuses(400))
            self.assertTrue((Path(folder)/'rejected'/'001.json').exists())
            self.assertFalse((Path(folder)/'002.json').exists());self.assertEqual(sent, [{'ok':True}])
    def test_server_and_auth_errors_stay_in_place_for_retry(self):
        class Fails:
            def __init__(self, status):self.status = status
            def send(self, *args):
                request = httpx.Request('POST', 'http://127.0.0.1:3000/api/worker/page')
                raise httpx.HTTPStatusError('x', request=request, response=httpx.Response(self.status, request=request))
        for status in (500, 401, 429):
            with tempfile.TemporaryDirectory() as folder:
                s=Spool(folder);s.save('page',{'data':'saved'},'001')
                with self.assertRaises(httpx.HTTPStatusError):s.flush(Fails(status))
                self.assertTrue((Path(folder)/'001.json').exists())
    def test_unreadable_spool_file_moves_aside(self):
        class Online:
            def send(self,*args):return {'ok':True}
        with tempfile.TemporaryDirectory() as folder:
            (Path(folder)/'001.json').write_text('{not json', encoding='utf8')
            Spool(folder).flush(Online())
            self.assertTrue((Path(folder)/'rejected'/'001.json').exists())
    def test_refused_record_does_not_stop_claims(self):
        calls = []
        class Api:
            def send(self, route, payload=None):
                calls.append(route)
                if route == 'page':
                    request = httpx.Request('POST', 'http://127.0.0.1:3000/api/worker/page')
                    raise httpx.HTTPStatusError('x', request=request, response=httpx.Response(400, request=request))
                return {'job': None}
        with tempfile.TemporaryDirectory() as folder:
            s=Spool(folder);s.save('page',{'x':1},'001')
            run(Api(), s, once=True)
        self.assertIn('claim', calls)


class RecordMatchesAppSchemaTests(unittest.TestCase):
    """Page records must pass the app's pageSchema (src/lib/validation.ts)."""
    def test_astral_title_cut_by_utf16_units(self):
        body = ('<html><title>' + '\U0001F600' * 300 + '</title><body>x</body></html>').encode('utf8')
        s = FakeSession(); s.get = lambda url: response(url, body=body)
        title = list(collector(s).collect({'mode':'pages','urls':['https://example.com/']}))[0]['title']
        self.assertLessEqual(len(title.encode('utf-16-le')) // 2, 500); self.assertEqual(len(title), 250)
    def test_redirect_to_non_public_address_is_a_failed_page(self):
        for final in ('http://1.1.1.1/', 'https://example.com:8443/', 'http://localhost/', 'http://localhost./', 'https://example.com/' + 'a' * 3000):
            s = FakeSession(); s.get = lambda url, final=final: response(final)
            record = list(collector(s).collect({'mode':'pages','urls':['https://example.com/']}))[0]
            self.assertEqual(record['status'], 'failed'); self.assertIsNone(record['final_url']); self.assertIn('redirected', record['error'])
    def test_crawl_skips_links_the_app_would_refuse(self):
        page = ('<html><title>T</title><body><a href="/' + 'a' * 3000 + '">long</a><a href="/ok">ok</a></body></html>').encode('utf8')
        s = FakeSession(); s.get = lambda url: response(url, body=page)
        urls = [r['url'] for r in collector(s).collect({'mode':'crawl','urls':['https://example.com/']})]
        self.assertIn('https://example.com/ok', urls); self.assertTrue(all(len(u) <= 2048 for u in urls))
    def test_public_url_matches_app_rule(self):
        self.assertTrue(public_url('https://example.com/a?b=1'))
        for bad in ('http://127.0.0.1/', 'http://[::1]/', 'https://user:pw@example.com/', 'ftp://example.com/', 'https://intranet/', 'https://printer.local/'):
            self.assertFalse(public_url(bad), bad)
    def test_empty_query_kept_like_the_app(self):
        self.assertEqual(canonical('https://example.com/?'), 'https://example.com/?')
        self.assertEqual(canonical('https://Example.com/a#x'), 'https://example.com/a')

if __name__=='__main__':unittest.main()
