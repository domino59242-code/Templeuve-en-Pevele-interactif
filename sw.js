/******************************************************************************
 * Templeuve Interactive — Service Worker
 *
 * Deux stratégies :
 * - fichiers de données (dossier data/ : lieux.json, categories.json) :
 *   "réseau d'abord, cache en secours". Les lieux ajoutés ou modifiés
 *   apparaissent donc dès la visite suivante, sans changer de version ;
 *   hors connexion, la dernière copie connue est utilisée.
 * - fichiers de l'application (HTML/CSS/JS/images) : "cache d'abord,
 *   réseau en secours", pour un affichage instantané et le mode hors-ligne.
 *
 * Important : incrémenter NOM_CACHE à chaque changement du CODE du site
 * (index.html, css, js, images) pour forcer les visiteurs à recharger ces
 * fichiers. Pour les seules données (data/*.json), ce n'est plus nécessaire.
 ******************************************************************************/

const NOM_CACHE = "templeuve-interactive-v12.5";

const FICHIERS_A_METTRE_EN_CACHE = [
    "./",
    "./index.html",
    "./manifest.json",
    "./css/style.css",
    "./js/app.js",
    "./data/lieux.json",
    "./data/categories.json",
    "./assets/favicon.svg",
    "./assets/feature-graphic.png",
    "./assets/blason-96.png",
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

    // Données (lieux, catégories) : on va d'abord chercher la version la plus
    // récente sur le réseau (en revalidant auprès du serveur), et on ne se
    // rabat sur la copie en cache qu'en l'absence de connexion.
    if(new URL(evenement.request.url).pathname.includes("/data/")){

        evenement.respondWith(

            fetch(evenement.request, { cache:"no-cache" }).then(reponseReseau=>{

                if(reponseReseau.ok && reponseReseau.type==="basic"){

                    const copie = reponseReseau.clone();

                    caches.open(NOM_CACHE).then(cache=>{
                        cache.put(evenement.request, copie);
                    });

                }

                return reponseReseau;

            }).catch(()=>{

                return caches.match(evenement.request).then(reponseEnCache=>{

                    return reponseEnCache || new Response(
                        "Contenu non disponible hors-ligne.",
                        { status: 503, statusText: "Hors-ligne" }
                    );

                });

            })

        );

        return;

    }

    evenement.respondWith(

        caches.match(evenement.request).then(reponseEnCache=>{

            if(reponseEnCache){
                return reponseEnCache;
            }

            return fetch(evenement.request).then(reponseReseau=>{

                // Met aussi en cache les nouveaux fichiers rencontrés, mais
                // seulement les réponses réussies : mémoriser une erreur (404
                // pour une image pas encore publiée, par exemple) la ferait
                // reservir pour toujours, même une fois le fichier en ligne.
                if(reponseReseau.ok && reponseReseau.type==="basic"){

                    const copie = reponseReseau.clone();

                    caches.open(NOM_CACHE).then(cache=>{
                        cache.put(evenement.request, copie);
                    });

                }

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
