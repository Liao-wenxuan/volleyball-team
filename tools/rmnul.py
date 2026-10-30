# push 后 GitHub 桌面端会在仓库根重建保留名文件 NUL，普通 API 删不掉，
# 用 \\?\ 扩展路径先 rename 成普通名字再删。跑法：python tools/rmnul.py
import os, sys

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = '\\\\?\\' + os.path.join(root, 'NUL')
dst = '\\\\?\\' + os.path.join(root, 'NUL.txt')
try:
    os.rename(src, dst)
    os.remove(dst)
    print('NUL removed')
except FileNotFoundError:
    print('no NUL file, nothing to do')
