# UI-Automatisierung (macOS, für Tests)

Hilfsprogramme, mit denen sich die laufende Desktop-App per Skript bedienen lässt.
Benötigt die Freigabe „Bedienungshilfen“ (und für Screenshots „Bildschirmaufnahme“)
für das aufrufende Programm.

```bash
swiftc -O -o tmp/win script/ui/win.swift
swiftc -O -o tmp/mouse script/ui/mouse.swift
tmp/win                                   # → Fensternummer X Y Breite Höhe
screencapture -x -o -l <Fensternummer> tmp/shot.png   # nur das di-drop-Fenster
tmp/mouse click <x> <y>                   # Bildschirmkoordinaten in Punkten
osascript -e 'tell application "System Events" to keystroke "g" using {command down, shift down}'
```
