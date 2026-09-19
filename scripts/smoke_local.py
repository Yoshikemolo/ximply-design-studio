"""Exercise only a disposable local-preview HTTP instance with a configured test token."""
import json
import os
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from check_styles import screen_stylesheets


def main() -> None:
    base = 'http://127.0.0.1:8090'
    with urlopen(base, timeout=10) as response:
        html = response.read().decode()
        assert 'xds-root' in html, 'Missing editor application'
    for stylesheet in screen_stylesheets(html):
        with urlopen(base+'/'+stylesheet.lstrip('/'), timeout=10) as response:
            assert response.headers.get_content_type() == 'text/css', 'Invalid stylesheet content type'
            assert b'.studio-shell' in response.read(), 'Missing editor layout styles'
    with urlopen(base+'/api/health', timeout=10) as response:
        assert json.load(response)['status'] == 'ok'
    try:
        urlopen(base+'/api/projects', timeout=10)
        raise AssertionError('Unauthenticated request was accepted')
    except HTTPError as error:
        assert error.code == 401
    document = {'format':'ximply-document','version':1,'name':'Disposable CI fixture','width':800,'height':600,'background':'#ffffff','layers':[]}
    headers = {'Authorization':'Bearer '+os.environ['XDS_API_TOKEN'], 'Content-Type':'application/json'}
    with urlopen(Request(base+'/api/projects', data=json.dumps(document).encode(), headers=headers),timeout=10) as response:
        identifier = json.load(response)['id']
    with urlopen(Request(base+'/api/projects/'+identifier,headers=headers),timeout=10) as response:
        assert json.load(response)==document, 'Artifact round-trip mismatch'
    with urlopen(base+'/assets/changelog/index.json',timeout=10) as response:
        version = json.load(response)['currentVersion']
    with urlopen(base+'/about?version='+version,timeout=10) as response:
        assert b'xds-root' in response.read(), 'SPA deep link failed'
    print('Local editor, API authentication, artifact round trip and About route passed.')


if __name__ == '__main__':
    main()
