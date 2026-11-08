"""Run from app root: <Scrapling Python> -m worker.main"""
import argparse
import json
import logging
import os
import threading
import time
from pathlib import Path
import httpx
from dotenv import load_dotenv
from .collector import Collector

log = logging.getLogger('worker')

class LeaseExpired(RuntimeError):pass

class API:
    def __init__(self, base, token):
        if not base.startswith('https://') and not base.startswith(('http://localhost:', 'http://127.0.0.1:')):
            raise ValueError('APP_URL must use HTTPS, except localhost development.')
        if len(token) < 32:raise ValueError('WORKER_TOKEN must contain at least 32 characters.')
        self.client = httpx.Client(base_url=base.rstrip('/')+'/api/worker/', headers={'Authorization':'Bearer '+token}, timeout=35, follow_redirects=False, trust_env=False)
    def send(self, route, payload=None):
        response = self.client.post(route, json=payload or {})
        if response.status_code == 409:raise LeaseExpired('Worker lease expired; local files preserved.')
        response.raise_for_status()
        return response.json()
    def close(self):self.client.close()

class Spool:
    def __init__(self, folder):
        self.path = Path(folder);self.path.mkdir(parents=True, exist_ok=True)
    def save(self, route, payload, name):
        target = self.path / (name+'.json');temp = target.with_suffix('.tmp')
        with temp.open('w',encoding='utf8') as file:
            json.dump({'route':route,'payload':payload}, file, ensure_ascii=False)
            file.flush();os.fsync(file.fileno())
        temp.replace(target)
        return target
    def keep(self, path, folder):
        # Move output aside for manual recovery; never silently discard it.
        target = self.path / folder;target.mkdir(exist_ok=True);path.replace(target/path.name)
    def flush(self, api):
        for path in sorted(self.path.glob('*.json')):
            try:
                data = json.loads(path.read_text(encoding='utf8'))
                route, payload = data['route'], data['payload']
            except (ValueError, KeyError, TypeError):
                self.keep(path, 'rejected');log.warning('Unreadable spool file moved aside: %s',path.name);continue
            try:api.send(route,payload)
            except LeaseExpired:
                self.keep(path, 'expired');log.warning('Expired upload preserved for manual recovery: %s',path.name)
            except httpx.HTTPStatusError as e:
                # The app refuses this upload for good. Retrying it before every
                # claim would stop the worker forever, so move it aside.
                if not permanent(e.response.status_code):raise
                self.keep(path, 'rejected')
                log.warning('Upload refused by the app (HTTP %s), kept in spool/rejected: %s',e.response.status_code,path.name)
            else:path.unlink()

def permanent(status):
    """4xx answers that retrying cannot fix. Auth, timeout and rate-limit answers stay retryable."""
    return 400 <= status < 500 and status not in (401, 403, 408, 409, 425, 429)

def run(api, spool, once=False):
    while True:
        try:
            spool.flush(api)
            job = api.send('claim').get('job')
            if job:
                lease = {'run_id':job['id'],'lease_token':job['lease_token']}
                stop = threading.Event()
                def heartbeats():
                    while not stop.wait(20):
                        try:api.send('heartbeat',lease)
                        except LeaseExpired:stop.set()
                        except Exception:log.warning('Heartbeat unavailable; output remains in local spool.')
                thread=threading.Thread(target=heartbeats,daemon=True);thread.start()
                error=None
                try:
                    collector=Collector(browser=job['fetch_mode']=='browser',chrome_path=os.getenv('CHROME_PATH'))
                    sequence = 0
                    def progress(stage, url):
                        nonlocal sequence
                        sequence += 1
                        try:api.send('progress', {**lease, 'seq':sequence, 'stage':stage, 'url':url})
                        except LeaseExpired:stop.set()
                        except Exception:pass  # Telemetry never prevents preservation.
                    collector.on_progress = progress
                    for index,page in enumerate(collector.collect(job,stop.is_set)):
                        progress('saving', page['url'])
                        spool.save('page',{**lease,'page':page},f"{job['id']}-{index:03}")
                        try:
                            spool.flush(api)
                            progress('pageComplete' if page['status']=='success' else 'failed', page['url'])
                        except Exception:log.warning('Upload unavailable; output saved locally.')
                    error=collector.limit_error
                except Exception as e:error=type(e).__name__
                finally:
                    if not stop.is_set():
                        spool.save('finish',{**lease,**({'error':error} if error else {})},f"{job['id']}-zzz-finish")
                        try:spool.flush(api)
                        except Exception:log.warning('Final upload pending in spool.')
                    stop.set();thread.join(timeout=2)
        except KeyboardInterrupt:break
        except Exception as e:log.warning('Worker request failed (%s). Will retry.',type(e).__name__)
        if once:break
        time.sleep(30)

def main():
    load_dotenv(Path(__file__).with_name('.env.local'))
    parser=argparse.ArgumentParser();parser.add_argument('--once',action='store_true');args=parser.parse_args()
    logging.basicConfig(level=logging.INFO,format='%(asctime)s %(levelname)s %(message)s')
    logging.getLogger('httpx').setLevel(logging.WARNING)
    api=API(os.environ['APP_URL'],os.environ['WORKER_TOKEN'])
    try:run(api,Spool(os.getenv('SPOOL_DIR','.runtime/spool')),args.once)
    finally:api.close()

if __name__=='__main__':main()
