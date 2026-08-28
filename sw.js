/******************************************************************************
 * Templeuve Interactive — Service Worker
 *
 * Stratégie simple : "cache d'abord, réseau en secours" pour les fichiers
 * de l'application (HTML/CSS/JS/données), afin que le site continue de
 * fonctionner même sans connexion, une fois qu'il a déjà été visité.
 *
 * Important : incrémenter NOM_CACHE à chaque changement de version du
 * site pour forcer les visiteurs à recharger les nouveaux fichiers.
 ******************************************************************************/

const NOM_CACHE = "templeuve-interactive-v2";

const FICHIERS_A_METTRE_EN_CACHE = [
    "./",
    "./index.html",
    "./manifest.json",
    "./css/style.css",
    "./js/app.js",
    "./data/lieux.json",
    "./data/categories.json",
    "./assets/favicon.svg",
    "./assets/icon-192.png",
    "./assets/icon-512.png"
];

self.addEventListener("install", (evenement)=>{

    evenement.waitUntil(

        caches.open(NOM_CACHE).then(cache=>{
            return cache.addAll(FICHIERS_A_METTRE_EN_CACHE);
        })

    );

    self.skipWaiting();

});

self.addEventListener("activate", (evenement)=>{

    evenement.waitUntil(

        caches.keys().then(cles=>{

            return Promise.all(
                cles
                    .filter(cle => cle!==NOM_CACHE)
                    .map(cle => caches.delete(cle))
            );

        })

    );

    self.clients.claim();

});

self.addEventListener("fetch", (evenement)=>{

    // On ne gère que les requêtes GET du même site (pas les tuiles de
    // carte externes, qui doivent toujours venir du réseau)
    if(evenement.request.method!=="GET") return;
    if(!evenement.request.url.startsWith(self.location.origin)) return;

    evenement.respondWith(

        caches.match(evenement.request).then(reponseEnCache=>{

            if(reponseEnCache){
                return reponseEnCache;
            }

            return fetch(evenement.request).then(reponseReseau=>{

                // Met aussi en cache les nouveaux fichiers rencontrés
                const copie = reponseReseau.clone();

                caches.open(NOM_CACHE).then(cache=>{
                    cache.put(evenement.request, copie);
                });

                return reponseReseau;

            }).catch(()=>{

                // Hors-ligne et rien en cache : on ne peut rien faire de
                // plus pour cette ressource précise.
                return new Response(
                    "Contenu non disponible hors-ligne.",
                    { status: 503, statusText: "Hors-ligne" }
                );

            });

        })

    );

});
