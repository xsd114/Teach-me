#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
在 github.com 被墙的机器上发版。

背景：本机 `git push` 走不通（github.com:443 连接被重置），但
`api.github.com` 和 `uploads.github.com` 直连正常。于是绕开 git 传输层：
用 Git Data API 写对象、用 Releases API 传安装包。

    python scripts/gh-publish.py status            # 看远端和本地的差距
    python scripts/gh-publish.py push              # 把本地新提交推上去
    python scripts/gh-publish.py sync              # 让本地 main 对齐远端 sha（内容零差异时用）
    python scripts/gh-publish.py release v1.2.0 --title "..." --body-file notes.md \
        --asset "release/Teach me-1.2.0-setup.exe" --asset "release/Teach me-1.2.0-x64.zip"

为什么需要 sync：GitHub 的 commits API 会把 message 末尾的换行吃掉，于是同一个内容
commit 出来的 sha 和本地不一致（树是完全一样的）。sync 会把远端 commit 对象在本地复刻
出来并让分支指过去，之后两边就一模一样了。

凭据：默认从 `git credential fill` 取（Windows 上就是 GCM 存的那个 token），
也可以用环境变量 GH_TOKEN / GITHUB_TOKEN。
"""
import argparse
import base64
import hashlib
import json
import os
import subprocess
import sys
from datetime import datetime

API = 'https://api.github.com'
UPLOADS = 'https://uploads.github.com'
OWNER = 'xsd114'
REPO = 'Teach-me'
WORK = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Windows 控制台默认 GBK，打印中文/符号会炸；统一按 UTF-8 输出，编不出来就用 ?
try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass


# ────────────────────────── 基础设施 ──────────────────────────

def token():
    for key in ('GH_TOKEN', 'GITHUB_TOKEN'):
        if os.environ.get(key):
            return os.environ[key].strip()
    env = dict(os.environ, GIT_TERMINAL_PROMPT='0', GCM_INTERACTIVE='never')
    r = subprocess.run(['git', 'credential', 'fill'], input='protocol=https\nhost=github.com\n\n',
                       capture_output=True, text=True, env=env)
    for line in r.stdout.splitlines():
        if line.startswith('password='):
            return line[len('password='):].strip()
    sys.exit('拿不到 GitHub token：先跑 gh auth login，或设 GH_TOKEN')


TOKEN = token()


def git(*args, binary=False):
    r = subprocess.run(['git', *args], cwd=WORK, capture_output=True)
    if r.returncode != 0:
        sys.exit('git %s 失败：%s' % (' '.join(args), r.stderr.decode('utf-8', 'replace')[:400]))
    return r.stdout if binary else r.stdout.decode('utf-8', 'replace').strip()


def http(method, url, payload=None, timeout='600', raw=False):
    """curl 兜一层：schannel 的吊销检查在这台机器上会抽风，统一 --ssl-no-revoke。"""
    args = ['curl.exe', '-sS', '--ssl-no-revoke', '--noproxy', '*', '--max-time', timeout,
            '-X', method, '-w', '\n%{http_code}',
            '-H', 'Authorization: token ' + TOKEN,
            '-H', 'User-Agent: teach-me',
            '-H', 'Accept: application/vnd.github+json']
    if payload is not None:
        fn = os.path.join(os.environ['TEMP'], 'gh_publish_payload.json')
        with open(fn, 'w', encoding='utf-8') as f:
            json.dump(payload, f, ensure_ascii=False)
        args += ['-H', 'Content-Type: application/json', '--data-binary', '@' + fn]
    args.append(url if url.startswith('http') else API + url)
    r = subprocess.run(args, capture_output=True)
    out = r.stdout.decode('utf-8', 'replace')
    body, _, code = out.rpartition('\n')
    if not code.strip().isdigit():
        sys.exit('curl 失败 %s %s：%s' % (method, url, r.stderr.decode('utf-8', 'replace')[:300]))
    if int(code) == 404 and method == 'GET':
        return None
    if int(code) >= 400:
        sys.exit('%s %s -> %s\n%s' % (method, url, code, body[:600]))
    return json.loads(body) if body.strip() else {}


def remote_head():
    return http('GET', '/repos/%s/%s/git/ref/heads/main' % (OWNER, REPO))['object']['sha']


def epoch(iso):
    return int(datetime.fromisoformat(iso.replace('Z', '+00:00')).timestamp())


# ────────────────────────── 命令 ──────────────────────────

def cmd_status(_a):
    head = remote_head()
    local = git('rev-parse', 'HEAD')
    print('远端 main :', head[:7])
    print('本地 HEAD :', local[:7])
    if head == local:
        print('两边一致，没活可干')
        return
    behind = git('rev-list', '--count', '%s..%s' % (head, local))
    ahead = git('rev-list', '--count', '%s..%s' % (local, head))
    print('待推送 %s 个提交 / 远端多出 %s 个提交' % (behind, ahead))
    for sha in [x for x in git('rev-list', '--reverse', '%s..%s' % (head, local)).split('\n') if x]:
        print('   ', sha[:7], git('log', '-1', '--pretty=%s', sha))


def cmd_push(_a):
    head = remote_head()
    local = git('rev-parse', 'HEAD')
    if head == local:
        print('没有要推的提交')
        return
    todo = [x for x in git('rev-list', '--reverse', '%s..%s' % (head, local)).split('\n') if x]
    print('要推 %d 个提交：%s' % (len(todo), ', '.join(s[:7] for s in todo)))
    cursor = head
    for sha in todo:
        meta = git('log', '-1', '--pretty=%an%x00%ae%x00%aI%x00%cn%x00%ce%x00%cI%x00%B', sha)
        an, ae, aI, cn, ce, cI = meta.split('\x00')[:6]
        message = '\x00'.join(meta.split('\x00')[6:])
        local_tree = git('rev-parse', sha + '^{tree}')
        parent_tree = http('GET', '/repos/%s/%s/git/commits/%s' % (OWNER, REPO, cursor))['tree']['sha']

        entries = []
        for line in git('diff-tree', '--no-commit-id', '--name-status', '-r', sha).split('\n'):
            if not line.strip():
                continue
            status, path = line.split('\t')[:2]
            if status.startswith('D'):
                entries.append({'path': path, 'mode': '100644', 'sha': None})
                continue
            content = git('cat-file', 'blob', '%s:%s' % (sha, path), binary=True)
            blob = http('POST', '/repos/%s/%s/git/blobs' % (OWNER, REPO),
                        {'content': base64.b64encode(content).decode('ascii'), 'encoding': 'base64'})
            mode = '100755' if git('ls-tree', sha, path).split()[0] == '100755' else '100644'
            entries.append({'path': path, 'mode': mode, 'sha': blob['sha']})
            print('  blob %-56s %7d B' % (path, len(content)))

        tree = http('POST', '/repos/%s/%s/git/trees' % (OWNER, REPO),
                    {'base_tree': parent_tree, 'tree': entries})
        if tree['sha'] != local_tree:
            sys.exit('树对不上：远端 %s / 本地 %s' % (tree['sha'], local_tree))
        print('  tree OK', tree['sha'])

        commit = http('POST', '/repos/%s/%s/git/commits' % (OWNER, REPO), {
            'message': message, 'tree': tree['sha'], 'parents': [cursor],
            'author': {'name': an, 'email': ae, 'date': aI},
            'committer': {'name': cn, 'email': ce, 'date': cI},
        })
        http('PATCH', '/repos/%s/%s/git/refs/heads/main' % (OWNER, REPO), {'sha': commit['sha'], 'force': False})
        print('  commit %s -> %s' % (commit['sha'][:7], sha[:7]))
        cursor = commit['sha']
    print('推完，远端 main =', cursor[:7])
    print('接着跑：python scripts/gh-publish.py sync')


def cmd_sync(_a):
    head = remote_head()
    chain = []
    cursor = head
    while True:
        if subprocess.run(['git', 'cat-file', '-e', cursor], cwd=WORK, capture_output=True).returncode == 0:
            print('本地已有', cursor[:7])
            break
        c = http('GET', '/repos/%s/%s/git/commits/%s' % (OWNER, REPO, cursor))
        chain.append(c)
        if not c['parents']:
            break
        cursor = c['parents'][0]['sha']
    written = 0
    for c in reversed(chain):
        lines = ['tree ' + c['tree']['sha']] + ['parent ' + p['sha'] for p in c['parents']]
        lines.append('author %s <%s> %d +0800' % (c['author']['name'], c['author']['email'], epoch(c['author']['date'])))
        lines.append('committer %s <%s> %d +0800' % (c['committer']['name'], c['committer']['email'], epoch(c['committer']['date'])))
        body = ('\n'.join(lines) + '\n\n' + c['message']).encode('utf-8')
        sha = hashlib.sha1(b'commit %d\0' % len(body) + body).hexdigest()
        if sha != c['sha']:
            print('复刻失败', c['sha'][:7])
            continue
        subprocess.run(['git', 'hash-object', '-w', '-t', 'commit', '--stdin'], cwd=WORK, input=body,
                       capture_output=True)
        written += 1
        print('复刻', sha[:7])
    if written or subprocess.run(['git', 'cat-file', '-e', head], cwd=WORK, capture_output=True).returncode == 0:
        subprocess.run(['git', 'update-ref', 'refs/heads/main', head], cwd=WORK, check=True)
        print('本地 main ->', head[:7])
        print(git('status', '--short') or '工作区干净')


def cmd_release(a):
    head = remote_head()
    rel = http('GET', '/repos/%s/%s/releases/tags/%s' % (OWNER, REPO, a.tag))
    body = open(a.body_file, encoding='utf-8').read() if a.body_file else (a.body or '')
    if rel:
        print('Release 已存在：', rel['html_url'])
    else:
        rel = http('POST', '/repos/%s/%s/releases' % (OWNER, REPO), {
            'tag_name': a.tag, 'target_commitish': head, 'name': a.title or a.tag,
            'body': body, 'draft': False, 'prerelease': False,
        })
        print('Release 建好：', rel['html_url'])

    have = {x['name'] for x in (http('GET', '/repos/%s/%s/releases/%s/assets' % (OWNER, REPO, rel['id'])) or [])}
    for path in a.asset or []:
        name = os.path.basename(path)
        if name in have:
            print('跳过（已存在）', name)
            continue
        size = os.path.getsize(path)
        print('上传 %s（%.1f MB）…' % (name, size / 1048576))
        url = '%s/repos/%s/%s/releases/%s/assets?name=%s' % (UPLOADS, OWNER, REPO, rel['id'],
                                                             name.replace(' ', '%20'))
        rc = subprocess.run(['curl.exe', '-sS', '--ssl-no-revoke', '--noproxy', '*', '--max-time', '2400',
                             '-X', 'POST', '-H', 'Authorization: token ' + TOKEN,
                             '-H', 'User-Agent: teach-me',
                             '-H', 'Content-Type: application/octet-stream',
                             '--data-binary', '@' + path, url], capture_output=True)
        out = rc.stdout.decode('utf-8', 'replace')
        try:
            info = json.loads(out)
            print('  ->', info.get('state'), info.get('size'))
        except Exception:
            sys.exit('上传失败：' + (out[:300] or rc.stderr.decode('utf-8', 'replace')[:300]))
    rel = http('GET', '/repos/%s/%s/releases/tags/%s' % (OWNER, REPO, a.tag))
    print('完成：', rel['html_url'])


def main():
    ap = argparse.ArgumentParser(description='GitHub 被墙时的发版工具')
    sub = ap.add_subparsers(dest='cmd', required=True)
    sub.add_parser('status')
    sub.add_parser('push')
    sub.add_parser('sync')
    r = sub.add_parser('release')
    r.add_argument('tag')
    r.add_argument('--title')
    r.add_argument('--body')
    r.add_argument('--body-file')
    r.add_argument('--asset', action='append')
    args = ap.parse_args()
    {'status': cmd_status, 'push': cmd_push, 'sync': cmd_sync, 'release': cmd_release}[args.cmd](args)


if __name__ == '__main__':
    main()
