-- "Initiale Lage" heißt jetzt "Lageerkundung"
UPDATE assignments SET title = 'Lageerkundung' WHERE kind = 'initial' AND title = 'Initiale Lage';
