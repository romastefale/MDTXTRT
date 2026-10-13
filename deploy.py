#!/usr/bin/env python3
"""Publica o MDTXTRT no Telegram Serverless (tgcloud) em uma única execução.

Alternativa ao Railway, que é o hospedeiro principal (ver DEPLOY.md).

Uso (na raiz do repositório):  python3 deploy.py

Executa os passos do DEPLOY.md, na ordem, e para no primeiro erro mostrando o
que falhou. Só usa a biblioteca padrão do Python; Node 24 e npm precisam estar
instalados. O token do tgcloud é digitado direto no `tgcloud login`: este script
não lê nem guarda o token.
"""
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CONFIG = ROOT / "tgcloud" / "lib" / "config.js"
URL_RE = re.compile(r"https://app[\w-]+\.tgcloud\.ai/?")


def titulo(texto):
    print(f"\n=== {texto} ===", flush=True)


def falhar(texto):
    print(f"\nERRO: {texto}", file=sys.stderr)
    print("Copie a mensagem acima (sem o token) e envie para continuar.", file=sys.stderr)
    sys.exit(1)


def rodar(args, capturar=False, interativo=False):
    """Roda um comando na raiz do repositório. Retorna o texto de saída se capturar=True."""
    print("$ " + " ".join(args), flush=True)
    if interativo or not capturar:
        r = subprocess.run(args, cwd=ROOT)
        if r.returncode != 0:
            falhar(f"o comando falhou (código {r.returncode}): {' '.join(args)}")
        return ""
    r = subprocess.run(args, cwd=ROOT, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    print(r.stdout, end="", flush=True)
    if r.returncode != 0:
        falhar(f"o comando falhou (código {r.returncode}): {' '.join(args)}")
    return r.stdout


def ler_url_configurada():
    m = re.search(r"CONFIGURED\s*=\s*'([^']*)'", CONFIG.read_text(encoding="utf-8"))
    return m.group(1) if m else ""


def gravar_url(url):
    texto = CONFIG.read_text(encoding="utf-8")
    novo, n = re.subn(r"(CONFIGURED\s*=\s*)'[^']*'", lambda m: f"{m.group(1)}'{url}'", texto, count=1)
    if n != 1:
        falhar(f"não achei CONFIGURED em {CONFIG}")
    CONFIG.write_text(novo, encoding="utf-8")


def main():
    if not (ROOT / "package.json").exists():
        falhar("rode este script na raiz do repositório (onde está o package.json).")
    for ferramenta in ("node", "npm", "npx"):
        if not shutil.which(ferramenta):
            falhar(f"'{ferramenta}' não encontrado. Instale o Node 24: https://nodejs.org/")

    titulo("1/6  Dependências e build")
    rodar(["npm", "install"])
    rodar(["npm", "run", "build"])
    rodar(["npm", "test"])

    titulo("2/6  Login no tgcloud")
    if (ROOT / ".tgcloud").exists():
        resp = input("Já existe um login salvo (.tgcloud/). Entrar de novo? [s/N] ").strip().lower()
        refazer = resp in ("s", "sim")
    else:
        refazer = True
    if refazer:
        print("Cole o token (app<id>:<secret>) quando o tgcloud pedir. Ele não passa por este script.")
        rodar(["npx", "tgcloud", "login"], interativo=True)

    titulo("3/6  Enviar código e site")
    saida = rodar(["npx", "tgcloud", "push"], capturar=True)
    rodar(["npx", "tgcloud", "migrate"], interativo=True)

    titulo("4/6  Endereço do Mini App")
    atual = ler_url_configurada()
    achada = URL_RE.search(saida)
    url = achada.group(0) if achada else ""
    if not url:
        url = (atual or input("Não achei o endereço na saída do push. Cole aqui (https://app<id>.tgcloud.ai/): ")).strip()
    if not url.startswith("https://"):
        falhar("o endereço do Mini App precisa começar com https://")
    if url != atual:
        gravar_url(url)
        print(f"MINI_APP_URL = {url}")
        rodar(["npx", "tgcloud", "push"], interativo=True)
    else:
        print(f"MINI_APP_URL já está configurada: {url}")

    titulo("5/6  Status")
    rodar(["npx", "tgcloud", "status"], interativo=True)

    titulo("6/6  Falta só o Telegram")
    print("Abra o bot no Telegram e envie /start. Depois teste /novo, /rascunhos, uma foto e um .md.")
    print("Se a MINI_APP_URL mudou, faça commit de tgcloud/lib/config.js para não perder o endereço.")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nInterrompido.")
        sys.exit(130)
