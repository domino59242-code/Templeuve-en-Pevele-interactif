# Templeuve Interactive

Carte interactive des lieux et services de Templeuve — développée en HTML/CSS/JavaScript avec [Leaflet](https://leafletjs.com/), sans base de données ni serveur (site statique).

## Structure du projet

```
index.html          → la carte interactive (page principale)
admin.html           → l'interface d'administration (ajouter/modifier des lieux et catégories)
css/style.css        → styles du site principal
css/admin.css         → styles de l'administration
js/app.js             → logique de la carte
js/admin.js           → logique de l'administration
data/lieux.json       → les lieux affichés sur la carte
data/categories.json  → les catégories (icône + couleur)
assets/               → images, favicon, icônes de l'application
manifest.json          → rend le site installable comme une application (PWA)
sw.js                  → permet un fonctionnement hors-ligne basique (PWA)
```

## Utiliser l'administration

Comme le site est statique, `admin.html` ne peut pas écrire directement sur le serveur. Le fonctionnement est donc :

1. Ouvrir le projet via un petit serveur local (voir plus bas), puis `admin.html`
2. Ajouter/modifier/supprimer des lieux et catégories
3. Télécharger les fichiers JSON à jour (boutons dédiés)
4. Remplacer `data/lieux.json` et/ou `data/categories.json` dans le projet
5. Publier les modifications (voir "Mettre à jour le site en ligne" plus bas)

## Tester le site en local

Un serveur local est nécessaire (les fichiers JSON ne se chargent pas en ouvrant `index.html` par un simple double-clic) :

```bash
python3 -m http.server 8000
```

puis ouvrir `http://localhost:8000`.

## Mettre le site en ligne (GitHub Pages)

Le projet est déjà versionné avec git, GitHub Pages est donc l'option la plus simple et gratuite :

1. Créer un dépôt sur [github.com](https://github.com) (ou utiliser le dépôt existant) et y pousser le projet :
   ```bash
   git add .
   git commit -m "Mise en ligne du site"
   git push
   ```
2. Sur GitHub : **Settings** → **Pages** → dans "Source", choisir la branche principale (`main`) et le dossier `/ (root)`
3. GitHub fournit une adresse du type `https://<utilisateur>.github.io/<nom-du-depot>/`

## Mettre à jour le site en ligne

Après avoir remplacé des fichiers via l'administration (ou modifié le code) :

```bash
git add .
git commit -m "Description de la mise à jour"
git push
```

Le site se met à jour automatiquement en quelques minutes.

## Installer le site comme une application

Le site est une PWA (Progressive Web App) : une fois visité en ligne (pas seulement en local), il peut être "installé" :

- **Android (Chrome)** : menu ⋮ → "Ajouter à l'écran d'accueil" / "Installer l'application"
- **iPhone/iPad (Safari)** : bouton de partage 􀈂 → "Sur l'écran d'accueil"
- **Ordinateur (Chrome/Edge)** : une icône d'installation apparaît dans la barre d'adresse

Une fois installé, le site fonctionne dans sa propre fenêtre (sans barre d'adresse) et reste consultable hors-ligne pour les pages déjà visitées.

**Important** : le service worker (`sw.js`) met les fichiers en cache. Après une mise à jour du site, incrémenter le numéro de version dans `sw.js` (`NOM_CACHE`) pour que les visiteurs reçoivent bien les nouveaux fichiers.
