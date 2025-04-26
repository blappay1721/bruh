@echo off
title Minecraft Server
:loop
echo Starting server...
java -Xmx12G -Xms12G -jar paper.jar nogui
echo Server crashed or closed! Restarting in 5 seconds...
timeout /t 5
goto loop
