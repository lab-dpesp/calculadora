#!/usr/bin/env python3
"""Baixa do site do TJSP a versão do mês da planilha "Cálculo Simples" (os índices mudam todo mês).

Procura o link na página do comunicado e grava em ferramentas/tjsp/planilhas/Calculo-Simples.xlsm.
Se o site não responder, mantém a cópia que já está no repositório e só avisa (o teste roda com ela).
"""
import html, os, re, sys, urllib.request

AQUI = os.path.dirname(os.path.abspath(__file__))
PAGINA = 'https://www.tjsp.jus.br/PrimeiraInstancia/CalculosJudiciais/Comunicado?codigoComunicado=338&pagina=1'
DESTINO = os.path.join(AQUI, 'planilhas', 'Calculo-Simples.xlsm')
UA = {'User-Agent': 'Mozilla/5.0 (calculadora DPESP; teste automatico)'}


def obter(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
        return r.read()


def main():
    try:
        pagina = obter(PAGINA).decode('utf-8', 'replace')
    except Exception as e:
        print('Aviso: não consegui abrir a página do TJSP (%s). Uso a planilha do repositório.' % e)
        return
    link = None
    for href, texto in re.findall(r'<a[^>]+href="([^"]*FileFetch\.ashx\?codigo=\d+)"[^>]*>(.*?)</a>', pagina, re.S | re.I):
        if re.search(r'c[aá]lculo\s+simples', re.sub('<[^>]+>', '', html.unescape(texto)), re.I):
            link = html.unescape(href); break
    if not link:
        print('Aviso: não achei o link "Cálculo Simples" na página do TJSP. Uso a planilha do repositório.')
        return
    try:
        dados = obter(link)
    except Exception as e:
        print('Aviso: não consegui baixar %s (%s). Uso a planilha do repositório.' % (link, e))
        return
    if not dados.startswith(b'PK'):
        print('Aviso: o arquivo baixado não é uma planilha .xlsm. Uso a planilha do repositório.')
        return
    with open(DESTINO, 'wb') as f:
        f.write(dados)
    print('Planilha do TJSP baixada de %s (%d KB).' % (link, len(dados) // 1024))


if __name__ == '__main__':
    main()
