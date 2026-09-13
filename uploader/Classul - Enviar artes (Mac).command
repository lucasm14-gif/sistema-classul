#!/bin/bash
cd "$(dirname "$0")"
node classul-uploader.mjs
echo
echo "O enviador parou. Pode fechar esta janela."
read -n 1
