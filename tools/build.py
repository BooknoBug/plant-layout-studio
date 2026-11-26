#!/usr/bin/env python3
"""Build the single-file app from src/.
  python3 tools/build.py                       -> index.html  (no layout inside: users open a .layout.json)
  python3 tools/build.py --embed layouts/X.layout.json --out dist/app-with-layout.html
                                               -> same app with one layout built in (e.g. for the Claude artifact)
The result opens by double-click (no server needed) and is what GitHub Pages serves."""
import pathlib, re, argparse
R = pathlib.Path(__file__).resolve().parent.parent
ap = argparse.ArgumentParser(); ap.add_argument('--embed'); ap.add_argument('--out', default=str(R/'index.html'))
a = ap.parse_args()
src = (R/'src/index.html').read_text(encoding='utf-8')
css = (R/'src/style.css').read_text(encoding='utf-8')
def js(name): return (R/'src'/name).read_text(encoding='utf-8').replace('</script', '<\\/script')
out = src.replace('<link rel="stylesheet" href="style.css">', '<style>\n' + css + '</style>')
out = re.sub(r"<!-- dev page:.*?-->\n", '', out, flags=re.S)
out = re.sub(r"<script>window\.UNDERLAY_URL=.*?</script>\n", '', out)
if a.embed:
    lay = pathlib.Path(a.embed).read_text(encoding='utf-8').replace('</', '<\\/').replace('�', '\\ufffd')
    out = out.replace('<script src="config.js"></script>', '<script>window.__UNDERLAY=' + lay + ';</script>\n<script src="config.js"></script>')
out = out.replace('<script src="config.js"></script>', '<script>\n' + js('config.js') + '</script>')
out = out.replace('<script src="app.js"></script>', '<script>\n' + js('app.js') + '</script>')
assert 'src="' not in out.split('<body>')[1], 'unreplaced script tag'
o = pathlib.Path(a.out); o.parent.mkdir(parents=True, exist_ok=True); o.write_text(out, encoding='utf-8')
ver = re.search(r"APP_VERSION='([^']+)'", out).group(1)
print(f'built {o.relative_to(R) if o.is_relative_to(R) else o}  v{ver}  {len(out)/1024:.0f} KB' + ('  (layout embedded)' if a.embed else ''))
