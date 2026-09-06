@echo off
:: Altera a codificação do prompt para UTF-8, corrigindo acentuações na tela
chcp 65001 > nul
title Inicializador - Cumprimento de Viagem

echo =======================================================
echo            INICIANDO CUMPRIMENTO DE VIAGEM
echo =======================================================
echo.
echo 1. Iniciando o servidor Python Flask em segundo plano...
:: Abre o Flask em uma nova janela para que você veja os logs se necessário
start "Servidor - Flask" cmd /k "python app.py"

echo 2. Aguardando a inicialização do sistema (3 segundos)...
timeout /t 3 /nobreak > nul

echo 3. Abrindo o Mozilla Firefox no endereço local...
:: Abre o Firefox diretamente na porta do Flask
start firefox "http://127.0.0.1:5000"

echo.
echo =======================================================
echo Processo concluído! O servidor está ativo.
echo Você pode fechar esta janela. O Flask continuará 
echo rodando na janela secundária que foi aberta.
echo =======================================================
timeout /t 5 > nul
exit