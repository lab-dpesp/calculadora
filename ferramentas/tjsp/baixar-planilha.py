#!/usr/bin/env python3
"""Baixa do site do TJSP a versão do mês das planilhas "Cálculo Simples" e "Atualização Monetária e Juros
Moratórios - Extenso" (os índices mudam todo mês).

Procura os links na página do comunicado e grava em ferramentas/tjsp/planilhas/ (Calculo-Simples.xlsm e Extenso.xlsm).
Se o site não responder, mantém a cópia que já está no repositório e só avisa (o teste roda com ela).
"""
import html, os, re, sys, urllib.request

AQUI = os.path.dirname(os.path.abspath(__file__))
PAGINA = 'https://www.tjsp.jus.br/PrimeiraInstancia/CalculosJudiciais/Comunicado?codigoComunicado=338&pagina=1'
PLANILHAS = [(r'c[aá]lculo\s+simples', 'Calculo-Simples.xlsm'), (r'extenso', 'Extenso.xlsm')]
UA = {'User-Agent': 'Mozilla/5.0 (calculadora DPESP; teste automatico)'}


def obter(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
        return r.read()


def main():
    try:
        pagina = obter(PAGINA).decode('utf-8', 'replace')
    except Exception as e:
        print('Aviso: não consegui abrir a página do TJSP (%s). Uso as planilhas do repositório.' % e)
        return
    links = re.findall(r'<a[^>]+href="([^"]*FileFetch\.ashx\?codigo=\d+)"[^>]*>(.*?)</a>', pagina, re.S | re.I)
    for padrao, nome in PLANILHAS:
        link = None
        for href, texto in links:
            if re.search(padrao, re.sub('<[^>]+>', '', html.unescape(texto)), re.I):
                link = html.unescape(href); break
        if not link:
            print('Aviso: não achei o link de %s na página do TJSP. Uso a planilha do repositório.' % nome)
            continue
        try:
            dados = obter(link)
        except Exception as e:
            print('Aviso: não consegui baixar %s (%s). Uso a planilha do repositório.' % (link, e))
            continue
        if not dados.startswith(b'PK'):
            print('Aviso: o arquivo baixado para %s não é uma planilha .xlsm. Uso a do repositório.' % nome)
            continue
        with open(os.path.join(AQUI, 'planilhas', nome), 'wb') as f:
            f.write(dados)
        print('%s baixada de %s (%d KB).' % (nome, link, len(dados) // 1024))

if __name__ == '__main__':
    main()
