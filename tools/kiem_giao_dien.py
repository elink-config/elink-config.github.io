# -*- coding: utf-8 -*-
"""SOAT HANG GIAO DIEN BI AN VINH VIEN.

    python tools/kiem_giao_dien.py

VI SAO CO FILE NAY: trong mot phien lam viec ngay 27/08 - 01/09/2026 da dinh
NAM lan cung mot kieu loi, moi lan o mot may khac nhau:

  - 7.5"  cum chon kieu hien PIN      : gac sau FwCheck.atLeast('1.9')
  - 7.5"  khu «Tu dong doi anh»        : gac sau FwCheck.atLeast('1.5')
  - 10.2" «Chu 3-6 / Thu / Ngay duong» : thieu han ham fwHasSixText()
  - 7.5"  «Hien lai anh» + «Lam nen»   : chi mo trong nhanh 'fw='
  - 7.3"  «Hien lai anh»               : khong he co nut nao

Chung mot goc: mot phan tu HTML khai style="display:none" roi KHONG AI MO, hoac
chi duoc mo o cho khong dang tin. Loi im lang tuyet doi — trang van chay, chi la
nguoi dung khong bao gio thay nut. Chi khach hang moi phat hien ra.

HAI CHO KHONG DANG TIN, va vi sao:

1. NHANH 'fw=' — goi khai phien ban CO THE ROT. May dang ve thi rot goi nhu
   choi, va goi cau hinh ~220 byte cung tung rot khi MTU con 23. Treo giao dien
   vao do la thinh thoang mat nut ma khong ai hieu tai sao. Cho DUNG la nhanh
   GOI CAU HINH: no luon toi khi da ket noi.

2. FwCheck.atLeast('X.Y') voi X.Y cao hon phien ban may — moc cua DONG MAY
   KHAC chep sang. Phep so LUON SAI nen hang do khong bao gio hien.

Cong cu nay KHONG doc duoc y dinh, nen no BAO NGHI chu khong bao loi. Doc tung
dong roi tu quyet: nhanh chet (vd `is7_5 ? true : atLeast(...)`) thi bo qua.
"""
import io
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

# Phien ban firmware THAT cua tung may — de biet moc atLeast nao khong bao gio dung.
FW = {
    '10_2': '2.0', '2_13n': '2.0', '2_9n': '2.0', '4_2': '3.0',
    '4_2c': '4.0', '7_3': '2.3', '7_5': '1.0', '7_5b': '1.0', '4_37': '1.0',
}


def ver(v):
    return tuple(int(x) for x in v.split('.'))


def doc(p):
    return io.open(p, encoding='utf-8', errors='replace').read()


# May dung CHUNG app cua may khac (webtool route theo ten BLE roi nap cung bo js).
ALIAS = {'4_2c': '4_2'}

# AN CO CHU Y — da soat tay 01/09/2026. Phai ghi LY DO: dong nao khong giai
# thich duoc thi dung cho vao day, no che mat dung thu cong cu sinh ra de bat.
BO_QUA = {
    ('7_5', 'dsDesignRow'): 'may chi co MOT «Tu thiet ke» (CUSTOM_SLOT_COUNT 1)',
    ('4_37', 'dsDesignRow'): 'may chi co MOT «Tu thiet ke»',
    ('7_5', 'hourlyFullRow'): 'may dung refreshModeRow (nhip BA muc), khong dung o cu',
    ('4_37', 'hourlyFullRow'): 'may dung refreshModeRow (nhip BA muc)',
    ('10_2', 'dsBgOldRow'): 'may CO khe nen rieng nen khong can duong lui muon khe anh',
    ('reader_4_2', 'previewTitle'): 'may doc sach: hien bang inline style luc gui sach',
    ('reader_4_2', 'sendProgress'): 'thanh tien do, hien bang inline style luc gui',
    ('reader_7_5', 'previewTitle'): 'nhu ban 4.2"',
    ('reader_7_5', 'sendProgress'): 'nhu ban 4.2"',
    # 7.5" chu lon: firmware DA GO HAN khe anh 02/08/2026 (anh 4bpp 122.880 B
    # khong vao noi khe 32KB, moi lenh 0x27 tra 'img=err'). Hang «Tu doi anh»
    # an la DUNG. Du an nay cung chua chuyen sang nen chung — khong dung vao.
    ('7_5b', 'imgAutoRow'): 'firmware may nay khong co khe anh, an la dung',
}


def js_cua_app(app):
    d = os.path.join(ROOT, 'js', ALIAS.get(app, app))
    if not os.path.isdir(d):
        return []
    return [os.path.join(d, f) for f in sorted(os.listdir(d)) if f.endswith('.js')]


def soat_app(app, fragment):
    """Tra ve danh sach dong canh bao cho mot may."""
    ra = []
    html = doc(fragment)
    # phan tu khai san display:none — thu tu thuoc tinh nao cung bat
    an = set()
    for m in re.finditer(r'id="([A-Za-z0-9_]+)"[^>]*style="[^"]*display\s*:\s*none', html):
        an.add(m.group(1))
    for m in re.finditer(r'style="[^"]*display\s*:\s*none[^"]*"[^>]*id="([A-Za-z0-9_]+)"', html):
        an.add(m.group(1))
    if not an:
        return ra

    nguon = [(p, doc(p)) for p in js_cua_app(app)]
    # cac file dung chung cung co the mo ho
    for ten in ('js/common/designer.js', 'js/family_epd.js', 'js/app_common.js'):
        p = os.path.join(ROOT, ten)
        if os.path.isfile(p):
            nguon.append((p, doc(p)))

    for eid in sorted(an):
        if (app, eid) in BO_QUA:
            continue
        # ID GHEP CHUOI: rat nhieu nut duoc mo bang vong lap, vd
        #     document.getElementById('showimgbutton' + (i + 1))
        # nen chuoi "showimgbutton3" KHONG he xuat hien trong js. Tim ca phan
        # goc da bo duoi so, khong thi bao gia day man hinh.
        goc = re.sub(r'\d+$', '', eid)
        ten_tim = [eid] if goc == eid else [eid, goc]
        cho_mo = []          # (file, dong, ngu canh)
        for p, s in nguon:
            dong = s.split('\n')
            for i, line in enumerate(dong):
                if not any(t in line for t in ten_tim):
                    continue
                t = line.strip()
                if t.startswith('//') or t.startswith('*') or t.startswith('/*'):
                    continue
                # CO PHAI CHO MO KHONG. Khong doi 'display' nam cung dong: rat
                # nhieu cho mo theo mang, vd
                #     ['dsBgRow', 'factoryResetRow'].forEach(id => {
                #        const e = document.getElementById(id);
                #        if (e) e.style.display = '';
                # nen phai soi mot CUA SO quanh dong do.
                cua_so = '\n'.join(dong[max(0, i - 8):i + 9])
                if 'display' not in cua_so:
                    continue
                # ⚠ PHAN BIET MO voi AN. Rat nhieu cho GAN display = 'none'
                # (vd disconnect() trong family_epd.js tat het hang khi rut
                # may). Dem chung thanh "duong mo sach" thi cong cu bo lot
                # dung truong hop no sinh ra de bat — da thu dung lai loi that
                # va no lot y nhu vay.
                gan = re.findall(r"\.style\.display\s*=\s*([^;\n]+)", cua_so)
                if gan and all("'none'" in g and "''" not in g and '?' not in g for g in gan):
                    continue  # chi toan lenh AN -> khong phai cho mo
                # Nhanh 'fw=' chi co the mo TRUOC do -> soi 25 dong truoc.
                truoc = '\n'.join(dong[max(0, i - 25):i])
                trong_fw = "startsWith('fw='" in truoc
                # ⚠ CONG GAC thi phai soi CA CUA SO, khong chi phan truoc: rat
                # hay gap dang
                #     const row = document.getElementById('imgShowRow');
                #     row.style.display = FwCheck.atLeast('X.Y') ? '' : 'none';
                # tuc cong gac nam SAU dong mang id. Chi soi phan truoc thi
                # cho nay trong "sach" va cong cu bo lot — da thu dung lai loi
                # that va no lot y nhu vay.
                # Bo dong CHU THICH truoc khi tim cong gac: nhieu khoi giai
                # thich co nhac atLeast(...) ("moc 1.9 la cua ban 4.2\"...")
                # va dem chung vao thi bao gia.
                ma = '\n'.join(l for l in cua_so.split('\n')
                               if not l.strip().startswith(('//', '*', '/*')))
                gac = re.findall(r"atLeast\(\s*'([0-9.]+)'", ma)
                gac_sai = [g for g in gac if app in FW and ver(g) > ver(FW[app])]
                cho_mo.append((os.path.relpath(p, ROOT).replace('\\', '/'), i + 1,
                               trong_fw, gac_sai))
        if not cho_mo:
            ra.append('  %-22s KHONG AI MO — an vinh vien' % eid)
            continue
        # con duong nao SACH khong (khong trong fw=, khong gac sai)?
        sach = [c for c in cho_mo if not c[2] and not c[3]]
        if sach:
            continue
        for f, ln, trong_fw, gac_sai in cho_mo:
            vi = []
            if trong_fw:
                vi.append("trong nhanh 'fw=' (goi nay CO THE ROT)")
            if gac_sai:
                vi.append('gac atLeast(%s) > fw may %s' % ('/'.join(gac_sai), FW.get(app, '?')))
            ra.append('  %-22s %s:%d — %s' % (eid, f, ln, '; '.join(vi)))
    return ra


def main():
    apps = os.path.join(ROOT, 'apps')
    tong = 0
    for f in sorted(os.listdir(apps)):
        if not f.endswith('.html'):
            continue
        app = f[:-5]
        canh = soat_app(app, os.path.join(apps, f))
        if canh:
            print('=== %s ===' % app)
            for c in canh:
                print(c)
            tong += len(canh)
    print()
    if tong:
        print('%d cho DANG NGHI. Doc tung dong: nhanh chet thi bo qua, con lai phai sua.' % tong)
    else:
        print('Khong thay hang giao dien nao bi an vinh vien.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
