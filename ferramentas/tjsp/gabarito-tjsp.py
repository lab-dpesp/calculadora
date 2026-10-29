#!/usr/bin/env python3
"""Gera casos aleatórios e os calcula na planilha oficial "Cálculo Simples" do TJSP, pelo LibreOffice.

A planilha é aberta sem macros; a calculadora só preenche os campos de entrada e lê os resultados das fórmulas.
Saída: um JSON com, para cada caso, a entrada e o que a planilha apurou (valor corrigido, juros e total).

  python3 ferramentas/tjsp/gabarito-tjsp.py [quantidade=300] [semente=1] [saida=ferramentas/tjsp/gabarito.json]

Opções de juros da planilha (aba Menus, célula B6) que são testadas:
  2  Tabela Prática + 1% a.m. até ago/2024, depois Selic menos correção  -> regime "tjsp" da calculadora
  3  Tabela Prática + Selic menos correção em todo o período             -> regime "taxalegal"
  4  Tabela Prática + juros fixos de 1% a.m.                              -> regime "fixa", 1%
Requer LibreOffice com o módulo Python (python3-uno).
"""
import datetime, json, os, random, subprocess, sys, tempfile, time

AQUI = os.path.dirname(os.path.abspath(__file__))
N = int(sys.argv[1]) if len(sys.argv) > 1 else 300
SEMENTE = int(sys.argv[2]) if len(sys.argv) > 2 else 1
SAIDA = sys.argv[3] if len(sys.argv) > 3 else os.path.join(AQUI, 'gabarito.json')
PLANILHA = os.environ.get('PLANILHA_TJSP', os.path.join(AQUI, 'planilhas', 'Calculo-Simples.xlsm'))

import uno  # noqa: E402  (vem com o LibreOffice)
from com.sun.star.beans import PropertyValue  # noqa: E402


def pv(n, v):
    p = PropertyValue(); p.Name = n; p.Value = v; return p


def iniciar_libreoffice():
    perfil = tempfile.mkdtemp(prefix='lo-tjsp-')
    porta = 2000 + random.Random().randint(100, 900)
    proc = subprocess.Popen(['soffice', '--headless', '--invisible', '--norestore', '--nologo', '--nodefault',
                             '-env:UserInstallation=file://' + perfil,
                             '--accept=socket,host=127.0.0.1,port=%d;urp;' % porta],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    local = uno.getComponentContext()
    res = local.ServiceManager.createInstanceWithContext('com.sun.star.bridge.UnoUrlResolver', local)
    for _ in range(60):
        try:
            ctx = res.resolve('uno:socket,host=127.0.0.1,port=%d;urp;StarOffice.ComponentContext' % porta)
            desk = ctx.ServiceManager.createInstanceWithContext('com.sun.star.frame.Desktop', ctx)
            return proc, desk
        except Exception:
            time.sleep(1)
    proc.kill()
    raise SystemExit('Não consegui iniciar o LibreOffice.')


def serial(iso):
    return (datetime.date.fromisoformat(iso) - datetime.date(1899, 12, 30)).days


def main():
    rnd = random.Random(SEMENTE)
    proc, desk = iniciar_libreoffice()
    doc = desk.loadComponentFromURL(uno.systemPathToFileUrl(os.path.abspath(PLANILHA)), '_blank', 0,
                                    (pv('Hidden', True), pv('MacroExecutionMode', 0), pv('ReadOnly', True)))
    try:
        f = doc.Sheets.getByName('FORMULÁRIO'); menus = doc.Sheets.getByName('Menus')
        ind = doc.Sheets.getByName('ÍNDICES')
        # Último mês com fator da Tabela Prática na planilha (coluna K da aba ÍNDICES).
        ultimo = None
        for r in range(3, 1000):
            d = ind.getCellRangeByName('A%d' % r).getValue()
            k = ind.getCellRangeByName('K%d' % r)
            if d and k.getType().value == 'VALUE':
                ultimo = datetime.date(1899, 12, 30) + datetime.timedelta(days=int(d))
        fim = datetime.date(ultimo.year, ultimo.month, 28)
        def data(de, ate):
            return (de + datetime.timedelta(days=rnd.randint(0, (ate - de).days))).isoformat()
        casos = []
        for i in range(N):
            opcao = rnd.choice([2, 2, 2, 3, 4])
            calc = data(datetime.date(2012, 1, 1), fim)
            ini = data(datetime.date(2008, 2, 1), datetime.date.fromisoformat(calc))
            juros = ini if rnd.random() < 0.7 else data(datetime.date.fromisoformat(ini), datetime.date.fromisoformat(calc))
            valor = round(rnd.uniform(100, 200000), 2)
            menus.getCellRangeByName('B6').setValue(opcao)
            f.getCellRangeByName('G8').setValue(serial(calc))
            f.getCellRangeByName('G16').setValue(valor)
            f.getCellRangeByName('G18').setValue(serial(ini))
            f.getCellRangeByName('Q16').setString('Sim')
            f.getCellRangeByName('Q22').setValue(serial(juros))
            doc.calculateAll()
            g = lambda a: f.getCellRangeByName(a).getValue()
            casos.append({'opcao': opcao, 'dataCalculo': calc, 'vencimento': ini, 'jurosDesde': juros, 'valor': valor,
                          'tj': {'corrigido': g('G26'), 'pctJurosFixos': g('Q18'), 'pctTaxaLegal': g('Q20'),
                                 'juros': g('Q26'), 'total': g('K32')}})
        json.dump({'planilha': os.path.basename(PLANILHA), 'indicesAte': ultimo.strftime('%Y-%m'), 'semente': SEMENTE,
                   'casos': casos}, open(SAIDA, 'w'), ensure_ascii=False, indent=1)
        print('%d casos calculados na planilha do TJSP (índices até %s) -> %s' % (len(casos), ultimo.strftime('%m/%Y'), SAIDA))
    finally:
        doc.close(True)
        try: desk.terminate()
        except Exception: pass
        proc.kill()


if __name__ == '__main__':
    main()
