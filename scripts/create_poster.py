"""Generate an 800 x 1800 mm vector poster. Requires reportlab; no app runtime dependency."""
import argparse
from pathlib import Path
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.colors import HexColor
from reportlab.lib.units import mm
from reportlab.graphics.barcode import qr
from reportlab.graphics.shapes import Drawing
from reportlab.graphics import renderPDF

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--font', default='C:/Windows/Fonts/msyh.ttc')
parser.add_argument('--output', default=str(ROOT / 'deliverables/harborflow-poster-800x1800mm.pdf'))
args = parser.parse_args()
font = Path(args.font)
if not font.exists():
    raise SystemExit('Provide a licensed CJK TrueType font using --font PATH')
pdfmetrics.registerFont(TTFont('CJK', str(font), subfontIndex=0))
out = Path(args.output)
out.parent.mkdir(parents=True, exist_ok=True)
c = canvas.Canvas(str(out), pagesize=(800 * mm, 1800 * mm), pageCompression=1)
c.setTitle('出海智台 HarborFlow | 800 × 1800 mm')
c.setAuthor('HarborFlow Project')
c.scale(mm, mm)
W,H=800,1800
GREEN='#173D38'; INK='#27433B'; MUTED='#718479'; CREAM='#F5F6EF'; GOLD='#E6AE7D'; WHITE='#FFFFFF'
def box(x,y,w,h,color,r=0):
    c.setFillColor(HexColor(color))
    if r:c.roundRect(x,H-y-h,w,h,r,stroke=0,fill=1)
    else:c.rect(x,H-y-h,w,h,stroke=0,fill=1)
def text(s,x,y,size=15,color=INK):
    c.setFillColor(HexColor(color));c.setFont('CJK',size);c.drawString(x,H-y-size,s)
def wrap(s,x,y,width,size=15,color=INK,leading=None):
    leading=leading or size*1.7
    line=''; yy=y
    for ch in s:
        if ch=='\n' or (line and pdfmetrics.stringWidth(line+ch,'CJK',size)>width):
            text(line,x,yy,size,color);yy+=leading;line='' if ch=='\n' else ch
        else:line+=ch
    if line:text(line,x,yy,size,color);yy+=leading
    return yy
def line(x,y,w,color='#DDE5DA'):
    c.setStrokeColor(HexColor(color));c.setLineWidth(.7);c.line(x,H-y,x+w,H-y)
def pill(s,x,y,w,color='#E9EFE3',fg=MUTED):
    box(x,y,w,28,color,14);text(s,x+12,y+6,10,fg)

box(0,0,W,H,CREAM)
box(0,0,W,500,GREEN)
text('HARBORFLOW',55,55,18,GOLD)
text('出海智台',53,105,58,WHITE)
text('你的多业务 AI 客服团队',58,197,26,'#D5E3D8')
line(58,261,684,'#4C6B5E')
text('把每一次对话，',56,293,41,WHITE)
text('推进成生意。',56,353,41,GOLD)
text('询盘  /  售后  /  上架  /  合规  /  人工协作',60,439,16,'#C1D5C6')

text('同一份商品事实，四种专业服务',55,543,27)
roles=[('01','销售顾问','理解采购需求\n生成双语回复与报价'),('02','售后专员','安抚并收集凭证\n需要判断时转给人工'),('03','上架运营','本地化标题与卖点\n多商品批量生成'),('04','合规顾问','标出声明与资料风险\n给出证据和处理建议')]
for i,(num,title,desc) in enumerate(roles):
    x=55+(i%2)*350;y=607+(i//2)*150
    box(x,y,335,133,WHITE,12);text(num,x+20,y+17,12,'#B29C7B');text(title,x+20,y+43,22);wrap(desc,x+20,y+81,290,12,MUTED,21)

text('让两个工作流，真的连起来',55,954,27)
box(55,1016,690,145,'#E8EEE1',12)
text('工作流 A  ·  从询盘到上架',77,1038,19)
text('采购需求',79,1087,17);text('→',204,1085,21,'#A0AE90')
text('双语报价',252,1087,17);text('→',377,1085,21,'#A0AE90')
text('两轮迭代',425,1087,17);text('→',550,1085,21,'#A0AE90')
text('Listing',606,1087,17)
text('商品快照与规则复用；金额由程序计算，模型负责商务表达。',79,1125,12,MUTED)
box(55,1177,690,132,WHITE,12)
text('工作流 B  ·  从客诉到人工处理',77,1198,19)
text('客户问题',79,1244,17);text('→',204,1242,21,'#A0AE90')
text('凭证清单',252,1244,17);text('→',377,1242,21,'#A0AE90')
text('风险初筛',425,1244,17);text('→',550,1242,21,'#A0AE90')
text('人工接管',598,1244,17)

text('看得见依据，留得住判断',55,1355,27)
for i,(big,small) in enumerate([('EN + DE','本地化双语草稿'),('V1 → V3','对话迭代与版本对比'),('8 条','有来源的规则知识')]):
    x=55+i*236;text(big,x,1420,28,GREEN);text(small,x,1465,13,MUTED)
line(55,1512,690)
wrap('平台规则 / 合规资料 / 商务条款 / 表达风险\n风险标记 + 文本批注 + 前后对比；每个结果都需要人工复核。',55,1533,690,14,MUTED,25)

box(0,1637,800,163,GREEN)
text('从一条询盘开始，现场体验完整闭环。',55,1664,19,WHITE)
text('扫码查看工程与运行说明',55,1708,13,GOLD)
text('github.com/slashzyc/1',55,1736,12,'#C1D5C6')
text('商业试点版 · 合成数据演示 · 不代表全面合规或自动上架',55,1769,8,'#AFC9B8')
widget=qr.QrCodeWidget('https://github.com/slashzyc/1')
bound=widget.getBounds();size=105
d=Drawing(size,size,transform=[size/(bound[2]-bound[0]),0,0,size/(bound[3]-bound[1]),0,0]);d.add(widget)
box(632,1662,113,113,WHITE,5);renderPDF.draw(d,c,636,H-1771)
c.showPage();c.save()
print(out)
