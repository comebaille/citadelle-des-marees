# Citadelle des marées

Jeu de tower defense autonome dans une cité engloutie bioluminescente de nuit, conçu en priorité pour iPhone (320 à 430 px, zones de sécurité iOS, contrôles tactiles à un pouce) et jouable hors ligne en PWA.

## Lancer le jeu en local

```bash
npm install
npm run dev
```

Build de production et prévisualisation locale :

```bash
npm run build
npm run preview
```

## Tests et vérification mobile

```bash
npm test
npm run verify:mobile
```

## Fonctionnalités

- **4 cartes** : *Atoll des Brisants*, *Détroit des Lanternes*, *Fosse des Anciens*, et *Récif Aléatoire* à graine reproductible.
- **Chemin dynamique** : recherche de plus court chemin en temps réel, placement interdit sur le courant sacré et blocage de toute issue refusé.
- **3 tours améliorables (niv. 1 à 3) et vendables** : *Harpon Corail* (tir rapide), *Mortier Abysses* (dégâts de zone), *Prisme Cryo-Algue* (faisceaux ralentisseurs).
- **8 vagues & Boss** : *Méduse-Éclair*, *Raie-Spectre*, *Crabe-Cuirasse* et le *Léviathan des Abysses*.
- **PWA hors ligne & WebAudio** : manifeste web, service worker généré automatiquement avec précachage des ressources, synthétiseur WebAudio activé au geste et meilleur score enregistré localement.
