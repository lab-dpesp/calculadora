#!/usr/bin/env python3
"""Gera casos aleatórios e os calcula numa planilha oficial do TJSP, pelo LibreOffice.

A planilha é aberta sem macros; o script só preenche os campos de entrada e lê os resultados das fórmulas.
Saída: um JSON com, para cada caso, a entrada e o que a planilha apurou (valor corrigido, juros e total).

  python3 ferramentas/tjsp/gabarito-tjsp.py [quantidade=300] [semente=1] [saida] [modelo=simples|extenso]

Modelo "simples" (planilha "Cálculo Simples"; aba Menus, célula B6), saída padrão gabarito.json:
  2  Tabela Prática + 1% a.m. até ago/2024, depois Selic menos correção  -> regime "tjsp" da calculadora
  3  Tabela Prática + Selic menos correção em todo o período             -> regime "taxalegal"
  4  Tabela Prática + juros fixos de 1% a.m.                              -> regime "fixa", 1%
Modelo "extenso" (planilha "Atualização Monetária e Juros Moratórios - Extenso", aba CÁLCULO INICIAL, contagem
"pro rata"), saída padrão gabarito-extenso.json:
  CC/02 (12% a.a. até 29/8/24; depois, Selic menos Correção)  -> "tjsp"
  Selic menos Correção desde jan./2003                        -> "taxalegal"
  Fixados (% a.a.), 12% a.a.                                   -> "fixa", 1%
  Selic Linearizada (juros desde o vencimento)                 -> "selic"
Requer LibreOffice com o módulo Python (python3-uno).
"""
import datetime, json, os, random, subprocess, sys, tempfile, time

AQUI = os.path.dirname(os.path.abspath(__file__))
N = int(sys.argv[1]) if len(sys.argv) > 1 else 300
SEMENTE = int(sys.argv[2]) if len(sys.argv) > 2 else 1
MODELO = sys.argv[4] if len(sys.argv) > 4 else 'simples'
SAIDA = sys.argv[3] if len(sys.argv) > 3 and sys.argv[3] else os.path.join(AQUI, 'gabarito.json' if MODELO == 'simples' else 'gabarito-extenso.json')
PLANILHA = os.environ.get('PLANILHA_TJSP', os.path.join(AQUI, 'planilhas', 'Calculo-Simples.xlsm' if MODELO == 'simples' else 'Extenso.xlsm'))
EXT_OPCOES = {
    'tjsp': 'CC/02 (6%ªª até 10/1/3; 12%ªª até 29/8/24; depois, Selic menos Correção)',
    'taxalegal': 'Selic menos Correção desde jan./2003, 6% a.a. antes disso',
    'fixa': 'Fixados (% a.a.):-',
    'selic': 'Selic Linearizada',
}

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


def extenso(desk):
    """Casos na planilha Extenso: uma parcela por caso, juros desde o vencimento ou de uma data posterior."""
    rnd = random.Random(SEMENTE)
    doc = desk.loadComponentFromURL(uno.systemPathToFileUrl(os.path.abspath(PLANILHA)), '_blank', 0,
                                    (pv('Hidden', True), pv('MacroExecutionMode', 0), pv('ReadOnly', True)))
    try:
        f = doc.Sheets.getByName('CÁLCULO INICIAL'); ind = doc.Sheets.getByName('ÍNDICES')
        # Último mês com fator da Tabela Prática (coluna O da aba ÍNDICES).
        ultimo = None
        for r in range(5, 1200):
            d = ind.getCellRangeByName('A%d' % r).getValue()
            if d and ind.getCellRangeByName('O%d' % r).getValue() > 0:
                ultimo = datetime.date(1899, 12, 30) + datetime.timedelta(days=int(d))
        fim = datetime.date(ultimo.year, ultimo.month, 28)
        def data(de, ate):
            return (de + datetime.timedelta(days=rnd.randint(0, (ate - de).days))).isoformat()
        casos = []
        for i in range(N):
            regime = rnd.choice(['tjsp', 'tjsp', 'tjsp', 'taxalegal', 'fixa', 'selic'])
            # Um terço dos casos com datas perto da mudança de agosto de 2024.
            if rnd.random() < 0.33:
                ini = data(datetime.date(2024, 6, 1), datetime.date(2024, 9, 15))
                calc = data(datetime.date.fromisoformat(ini), fim)
            else:
                calc = data(datetime.date(2012, 1, 1), fim)
                ini = data(datetime.date(2008, 2, 1), datetime.date.fromisoformat(calc))
            juros = ini if (regime == 'selic' or rnd.random() < 0.7) else data(datetime.date.fromisoformat(ini), datetime.date.fromisoformat(calc))
            valor = round(rnd.uniform(100, 200000), 2)
            f.getCellRangeByName('I20').setString(EXT_OPCOES[regime])
            f.getCellRangeByName('J20').setValue(0.12)
            f.getCellRangeByName('O20').setString('pro rata')
            f.getCellRangeByName('O34').setString('Não')
            f.getCellRangeByName('D19').setValue(serial(calc))
            f.getCellRangeByName('I37').setValue(serial(juros))
            f.getCellRangeByName('B40').setValue(serial(ini))
            f.getCellRangeByName('D40').setValue(valor)
            doc.calculateAll()
            g = lambda a: f.getCellRangeByName(a).getValue()
            casos.append({'opcao': regime, 'dataCalculo': calc, 'vencimento': ini, 'jurosDesde': juros, 'valor': valor,
                          'tj': {'corrigido': g('H40'), 'pctJurosFixos': g('K40'), 'pctTaxaLegal': g('L40'),
                                 'juros': g('I40'), 'total': g('N40')}})
        json.dump({'planilha': os.path.basename(PLANILHA), 'modelo': 'extenso', 'indicesAte': ultimo.strftime('%Y-%m'),
                   'semente': SEMENTE, 'casos': casos}, open(SAIDA, 'w'), ensure_ascii=False, indent=1)
        print('%d casos calculados na planilha Extenso do TJSP (índices até %s) -> %s' % (len(casos), ultimo.strftime('%m/%Y'), SAIDA))
    finally:
        doc.close(True)


def main():
    if MODELO == 'extenso':
        proc, desk = iniciar_libreoffice()
        try:
            extenso(desk)
        finally:
            try: desk.terminate()
            except Exception: pass
            proc.kill()
        return
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
        json.dump({'planilha': os.path.basename(PLANILHA), 'modelo': 'simples', 'indicesAte': ultimo.strftime('%Y-%m'), 'semente': SEMENTE,
                   'casos': casos}, open(SAIDA, 'w'), ensure_ascii=False, indent=1)
        print('%d casos calculados na planilha do TJSP (índices até %s) -> %s' % (len(casos), ultimo.strftime('%m/%Y'), SAIDA))
    finally:
        doc.close(True)
        try: desk.terminate()
        except Exception: pass
        proc.kill()


if __name__ == '__main__':
    main()
