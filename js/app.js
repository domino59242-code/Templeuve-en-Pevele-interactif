/******************************************************************************
 * Templeuve Interactive
 * Version 0.5
 *
 * Journal des corrections (v0.4 -> v0.5) :
 *  - BUG CRITIQUE : couleurCategorie() et creerIcone() étaient imbriquées
 *    dans icone() (accolade manquante), donc invisibles hors de cette
 *    fonction. creerIcone() était appelée ailleurs -> l'appli était cassée
 *    (ReferenceError, plus aucun marqueur ne s'affichait).
 *  - Sécurité : toutes les données injectées en HTML sont désormais
 *    échappées (échapperHtml) pour éviter les failles XSS si le contenu
 *    de lieux.json vient un jour d'une source modifiable (formulaire,
 *    import, etc.).
 *  - Logique de filtre simplifiée et sécurisée contre les champs
 *    null/undefined.
 *  - Accessibilité : éléments de liste focusables au clavier
 *    (tabindex, role, gestion Entrée/Espace), aria-label sur la recherche.
 *  - Recherche "debouncée" pour éviter de re-filtrer à chaque frappe.
 *  - Nettoyage de la sélection quand le lieu sélectionné disparaît du
 *    filtre courant.
 *  - Gestion d'erreur sur le chargement de data/lieux.json.
 ******************************************************************************/

const CENTRE_VILLE = [50.5230, 3.1710];
const ZOOM_DEPART = 15;

// Les catégories (icône + couleur) sont chargées depuis data/categories.json
// au démarrage (voir chargerLieux()). Cela permet d'ajouter/modifier une
// catégorie via la page admin.html sans toucher à ce fichier.
let CATEGORIES = {};
const CATEGORIE_DEFAUT = { icone: "📍", couleur: "#555555" };

//==================================================
// Utilitaires
//==================================================

// Empêche l'injection HTML depuis les données (nom, description, etc.)
function echapperHtml(texte){

    const div = document.createElement("div");
    div.textContent = texte ?? "";
    return div.innerHTML;

}

function icone(cat){
    return (CATEGORIES[cat] ?? CATEGORIE_DEFAUT).icone;
}

function couleurCategorie(cat){
    return (CATEGORIES[cat] ?? CATEGORIE_DEFAUT).couleur;
}

// Une icône peut être un emoji (texte) ou une image uploadée via l'admin
// (stockée en data-URL base64 dans categories.json)
function estImageIcone(valeur){
    return typeof valeur==="string" && valeur.startsWith("data:image");
}

// Affiche l'icône d'une catégorie sous forme de <img> ou de texte (emoji)
function rendreIcone(cat){

    const valeur = icone(cat);

    if(estImageIcone(valeur)){
        return `<img src="${valeur}" class="icone-categorie" alt="">`;
    }

    return echapperHtml(valeur);

}

// Les événements temporaires ont une icône/couleur fixe, indépendante du
// système de catégories (ils n'ont pas besoin d'appartenir à l'une d'elles)
function iconeLieu(lieu){
    return lieu.estEvenement ? "🎉" : icone(lieu.categorie);
}

function couleurLieu(lieu){
    return lieu.estEvenement ? "var(--couleur-accent)" : couleurCategorie(lieu.categorie);
}

function rendreIconeLieu(lieu){
    return lieu.estEvenement ? "🎉" : rendreIcone(lieu.categorie);
}

// Simple debounce pour éviter de refiltrer à chaque frappe clavier
function debounce(fn, delai){

    let timer = null;

    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), delai);
    };

}

//==================================================
// Horaires d'ouverture
//
// Format attendu dans lieux.json : un objet avec une clé par jour
// (lundi..dimanche), chacune un tableau de créneaux "HH:MM-HH:MM".
// Un jour absent ou vide = fermé / non renseigné ce jour-là.
//==================================================

const JOURS_SEMAINE = [
    { cle:"lundi",    label:"Lundi" },
    { cle:"mardi",    label:"Mardi" },
    { cle:"mercredi", label:"Mercredi" },
    { cle:"jeudi",    label:"Jeudi" },
    { cle:"vendredi", label:"Vendredi" },
    { cle:"samedi",   label:"Samedi" },
    { cle:"dimanche", label:"Dimanche" }
];

// Un lieu "a des horaires" seulement si au moins un jour a un créneau
function aDesHoraires(horaires){

    if(!horaires) return false;

    return JOURS_SEMAINE.some(j => (horaires[j.cle] ?? []).length>0);

}

// Détermine si un lieu est ouvert à l'instant présent (heure du navigateur)
function estOuvertMaintenant(horaires){

    if(!aDesHoraires(horaires)) return null;

    const maintenant = new Date();

    // getDay() renvoie 0 pour dimanche ; on décale pour retomber sur
    // notre tableau JOURS_SEMAINE qui commence le lundi (index 0)
    const indexJour = (maintenant.getDay()+6)%7;
    const creneaux = horaires[JOURS_SEMAINE[indexJour].cle] ?? [];

    const minutesActuelles = maintenant.getHours()*60 + maintenant.getMinutes();

    return creneaux.some(creneau=>{

        const [debut, fin] = creneau.split("-");
        const [hD,mD] = debut.split(":").map(Number);
        const [hF,mF] = fin.split(":").map(Number);

        const minDebut = hD*60+mD;
        const minFin = hF*60+mF;

        return minutesActuelles>=minDebut && minutesActuelles<minFin;

    });

}

// Construit le HTML du tableau hebdomadaire des horaires
function tableauHorairesHtml(horaires){

    const indexAujourdhui = (new Date().getDay()+6)%7;

    const lignes = JOURS_SEMAINE.map((jour,index)=>{

        const creneaux = horaires[jour.cle] ?? [];

        const texte = creneaux.length>0
            ? creneaux.map(c=>echapperHtml(c.replace("-"," - "))).join(", ")
            : "Fermé";

        const classeAujourdhui = index===indexAujourdhui ? " ligneAujourdhui" : "";

        return `
            <div class="ligneHorairesFiche${classeAujourdhui}">
                <span class="jourHorairesFiche">${jour.label}</span>
                <span class="creneauxHorairesFiche">${texte}</span>
            </div>
        `;

    }).join("");

    return `<div class="tableauHorairesFiche">${lignes}</div>`;

}

//==================================================
// Écran d'accueil
//==================================================

function afficherEcranAccueil(){

    const conteneur = document.getElementById("ecranAccueil");

    if(sessionStorage.getItem("templeuve_accueil_vu")==="true"){
        conteneur.classList.add("masque");
        return;
    }

    const lieuxVedette = lieux.filter(l=>l.vedette).slice(0,4);

    // Si aucun lieu n'est marqué "en vedette", on en propose quand même
    // quelques-uns au hasard pour que l'écran d'accueil ne soit pas vide
    const lieuxAffiches = lieuxVedette.length>0
        ? lieuxVedette
        : [...lieux].sort(()=>Math.random()-0.5).slice(0,3);

    const conteneurVedette = document.getElementById("lieuxVedetteAccueil");

    conteneurVedette.innerHTML = lieuxAffiches.map(lieu => `
        <div class="carteVedette" data-id="${lieu.id}">
            <span>${rendreIconeLieu(lieu)}</span>
            <div>
                <div class="nomVedette">${echapperHtml(lieu.nom)}</div>
                <div class="categorieVedette">${echapperHtml(lieu.categorie)}</div>
            </div>
        </div>
    `).join("");

    conteneurVedette.querySelectorAll(".carteVedette").forEach(elementCarte=>{

        elementCarte.addEventListener("click", ()=>{

            const lieu = lieux.find(l => l.id===Number(elementCarte.dataset.id));

            fermerEcranAccueil();

            if(lieu){
                carte.setView([lieu.latitude, lieu.longitude], 17);
                afficherFiche(lieu);
            }

        });

    });

}

function fermerEcranAccueil(){

    sessionStorage.setItem("templeuve_accueil_vu", "true");
    document.getElementById("ecranAccueil").classList.add("masque");

}

document.getElementById("btnDecouvrirCarte").addEventListener("click", fermerEcranAccueil);

//==================================================
// Accessibilité : taille du texte et contraste élevé
//
// Les préférences sont mémorisées dans le navigateur (localStorage) et
// réappliquées automatiquement à chaque visite.
//==================================================

const CLE_PREFS_ACCESSIBILITE = "templeuve_prefs_accessibilite";
const ECHELLES_POLICE = [1, 1.15, 1.3, 1.45];

function chargerPrefsAccessibilite(){

    try{
        const brut = localStorage.getItem(CLE_PREFS_ACCESSIBILITE);
        return brut ? JSON.parse(brut) : { indexEchelle: 0, contraste: false };
    }catch(erreur){
        return { indexEchelle: 0, contraste: false };
    }

}

function sauvegarderPrefsAccessibilite(prefs){

    try{
        localStorage.setItem(CLE_PREFS_ACCESSIBILITE, JSON.stringify(prefs));
    }catch(erreur){
        console.warn("Préférences d'accessibilité non sauvegardées :", erreur);
    }

}

function appliquerPrefsAccessibilite(prefs){

    const application = document.getElementById("application");

    application.style.zoom = ECHELLES_POLICE[prefs.indexEchelle];

    document.body.classList.toggle("contraste-eleve", prefs.contraste);
    document.getElementById("chkContraste").checked = prefs.contraste;

}

(function initAccessibilite(){

    let prefs = chargerPrefsAccessibilite();

    appliquerPrefsAccessibilite(prefs);

    const btn = document.getElementById("btnAccessibilite");
    const panneau = document.getElementById("panneauAccessibilite");

    btn.addEventListener("click", ()=>{

        const ouvert = !panneau.hidden;

        panneau.hidden = ouvert;
        btn.setAttribute("aria-expanded", String(!ouvert));

    });

    document.getElementById("btnPolicePlus").addEventListener("click", ()=>{
        prefs.indexEchelle = Math.min(prefs.indexEchelle+1, ECHELLES_POLICE.length-1);
        appliquerPrefsAccessibilite(prefs);
        sauvegarderPrefsAccessibilite(prefs);
    });

    document.getElementById("btnPoliceMoins").addEventListener("click", ()=>{
        prefs.indexEchelle = Math.max(prefs.indexEchelle-1, 0);
        appliquerPrefsAccessibilite(prefs);
        sauvegarderPrefsAccessibilite(prefs);
    });

    document.getElementById("btnPoliceDefaut").addEventListener("click", ()=>{
        prefs.indexEchelle = 0;
        appliquerPrefsAccessibilite(prefs);
        sauvegarderPrefsAccessibilite(prefs);
    });

    document.getElementById("chkContraste").addEventListener("change", (e)=>{
        prefs.contraste = e.target.checked;
        appliquerPrefsAccessibilite(prefs);
        sauvegarderPrefsAccessibilite(prefs);
    });

})();

//==================================================
// Création de la carte
//==================================================

const carte = L.map("map").setView(CENTRE_VILLE, ZOOM_DEPART);

// Fond de carte Plan IGN : données officielles françaises (IGN), plus
// précises sur les petites communes que les fonds génériques mondiaux
// (bâtiments, chemins, voirie). Gratuit et sans clé via la Géoplateforme.
const coucheFond = L.tileLayer(
    "https://data.geopf.fr/wmts?LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&STYLE=normal&TILEMATRIXSET=PM&SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&FORMAT=image/png&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}",
    {
        attribution: "&copy; IGN",
        maxZoom: 19
    }
).addTo(carte);

//==================================================
// Eléments HTML
//==================================================

const txtRecherche = document.getElementById("search");
const btnEffacerRecherche = document.getElementById("btnEffacerRecherche");
const cboCategorie = document.getElementById("categorie");
const cboSousCategorie = document.getElementById("sousCategorie");
const liste = document.getElementById("listeLieux");
const compteur = document.getElementById("compteur");
const ficheLieu = document.getElementById("ficheLieu");

function afficherFiche(lieu){

    const ouvert = estOuvertMaintenant(lieu.horaires);

    ficheLieu.innerHTML = `

        <button type="button" class="btnRetourListe" id="btnRetourListe">
            ← Retour à la liste
        </button>

        <div class="filAriane">
            <button type="button" id="filArianeTous">Tous les lieux</button>
            <span class="separateurAriane">›</span>
            <button type="button" id="filArianeCategorie">${echapperHtml(lieu.categorie)}</button>
            ${
                lieu.sousCategorie
                ?
                `<span class="separateurAriane">›</span>
                <button type="button" id="filArianeSousCategorie">${echapperHtml(lieu.sousCategorie)}</button>`
                :
                ""
            }
            <span class="separateurAriane">›</span>
            <span>${echapperHtml(lieu.nom)}</span>
        </div>

        <div class="fiche">

            ${
                lieu.photo
                ?
                `<div class="fichePhoto">
                    <img
                        src="${echapperHtml(lieu.photo)}"
                        alt="Photo de ${echapperHtml(lieu.nom)}"
                        onerror="this.parentElement.style.display='none';">
                </div>`
                :
                ""
            }

            <div class="ficheTitre">

                ${rendreIconeLieu(lieu)} ${echapperHtml(lieu.nom)}

            </div>

            <div class="ficheCategorie">

                ${echapperHtml(lieu.categorie)}${lieu.sousCategorie ? ` › ${echapperHtml(lieu.sousCategorie)}` : ""}

            </div>

            ${
                ouvert===null
                ?
                ""
                :
                ouvert
                ?
                `<div class="badgeHoraires badgeOuvert">🟢 Ouvert maintenant</div>`
                :
                `<div class="badgeHoraires badgeFerme">🔴 Fermé actuellement</div>`
            }

            ${
                lieu.dateFin
                ?
                `<div class="badgeEvenement">🎉 ${echapperHtml(texteJoursRestants(lieu))}</div>`
                :
                ""
            }

            <hr>

            ${
                lieu.estEvenement
                ?
                `
                <div class="ficheLigne">
                    📅 ${
                        lieu.dateDebut===lieu.dateFin
                        ? formaterDateFrLongue(lieu.dateDebut)
                        : `Du ${formaterDateFrLongue(lieu.dateDebut)} au ${formaterDateFrLongue(lieu.dateFin)}`
                    }
                </div>

                ${
                    lieu.horairesEvenement
                    ?
                    `<div class="ficheLigne">🕒 ${echapperHtml(lieu.horairesEvenement)}</div>`
                    :
                    ""
                }
                `
                :
                ""
            }

            <div class="ficheLigne">

                📍 ${echapperHtml(lieu.adresse)}

            </div>

            ${
                lieu.telephone
                ?
                `<div class="ficheLigne">☎ ${echapperHtml(lieu.telephone)}</div>`
                :
                ""
            }

            ${
                lieu.mail
                ?
                `<div class="ficheLigne">✉ ${echapperHtml(lieu.mail)}</div>`
                :
                ""
            }

            ${
                lieu.site
                ?
                `<div class="ficheLigne">

                    🌍
                    <a href="${echapperHtml(lieu.site)}" target="_blank" rel="noopener noreferrer">
                        ${echapperHtml(lieu.site)}
                    </a>

                </div>`
                :
                ""
            }

            ${
                lieu.description
                ?
                `
                <hr>

                <div class="ficheDescription">

                    ${echapperHtml(lieu.description)}

                </div>
                `
                :
                ""
            }

            ${
                aDesHoraires(lieu.horaires)
                ?
                `
                <hr>

                <div class="ficheSousTitre">🕒 Horaires d'ouverture</div>

                ${tableauHorairesHtml(lieu.horaires)}
                `
                :
                ""
            }

        </div>

    `;

    // Fil d'Ariane : revenir à la liste complète ou filtrer sur la catégorie
    document.getElementById("filArianeTous").addEventListener("click", ()=>{
        txtRecherche.value = "";
        btnEffacerRecherche.hidden = true;
        cboCategorie.value = "Toutes";
        creerSousCategories();
        afficher();
        ficheLieu.innerHTML = "<p>Sélectionnez un lieu sur la carte ou dans la liste.</p>";
    });

    document.getElementById("filArianeCategorie").addEventListener("click", ()=>{
        cboCategorie.value = lieu.categorie;
        creerSousCategories();
        afficher();
    });

    if(lieu.sousCategorie){

        document.getElementById("filArianeSousCategorie").addEventListener("click", ()=>{
            cboCategorie.value = lieu.categorie;
            creerSousCategories();
            cboSousCategorie.value = lieu.sousCategorie;
            afficher();
        });

    }

    // Bouton retour (visible uniquement sur petit écran, voir CSS) :
    // remonte simplement en haut de la barre latérale, là où se trouve la liste
    document.getElementById("btnRetourListe").addEventListener("click", ()=>{
        liste.scrollIntoView({behavior:"smooth", block:"start"});
    });

}

// Texte du badge "événement" : nombre de jours restants avant la fin
// Formate une date ISO (YYYY-MM-DD) en "31 juillet 2026"
function formaterDateFrLongue(dateIso){

    const MOIS = [
        "janvier","février","mars","avril","mai","juin",
        "juillet","août","septembre","octobre","novembre","décembre"
    ];

    const [annee, mois, jour] = dateIso.split("-").map(Number);

    return `${jour} ${MOIS[mois-1]} ${annee}`;

}

function texteJoursRestants(lieu){

    const maintenant = new Date();
    maintenant.setHours(0,0,0,0);

    if(lieu.dateDebut){

        const debut = new Date(lieu.dateDebut+"T00:00:00");

        if(debut > maintenant){

            const joursAvant = Math.round((debut-maintenant) / (1000*60*60*24));

            if(joursAvant===1) return "Commence demain";

            return `Commence dans ${joursAvant} jours`;

        }

    }

    const fin = new Date(lieu.dateFin+"T00:00:00");

    const joursRestants = Math.round((fin-maintenant) / (1000*60*60*24));

    if(joursRestants<=0) return "Dernier jour !";
    if(joursRestants===1) return "Se termine demain";

    return `Se termine dans ${joursRestants} jours`;

}

// Un lieu est un "événement expiré" si sa date de fin est déjà passée
function evenementExpire(lieu){

    if(!lieu.dateFin) return false;

    const maintenant = new Date();
    maintenant.setHours(0,0,0,0);

    const fin = new Date(lieu.dateFin+"T00:00:00");

    return fin < maintenant;

}

//==================================================

let lieux = [];
// Regroupe les marqueurs proches en grappes numérotées quand on dézoome,
// pour garder la carte lisible même avec beaucoup de lieux.
let groupe = L.markerClusterGroup({
    spiderfyOnMaxZoom: true,
    showCoverageOnHover: false,
    maxClusterRadius: 50
}).addTo(carte);
let elementSelectionne = null;
let idLieuSelectionne = null;

// Marqueur de sélection : un repère distinct qui pulse, ajouté directement
// sur la carte (pas dans le groupe de clustering) pour toujours indiquer
// clairement l'emplacement exact du lieu choisi, quel que soit le zoom.
let marqueurSelection = null;

function placerMarqueurSelection(lieu){

    const icone = L.divIcon({
        className: "",
        html: `<div class="pulseSelection"><div class="pointSelection"></div></div>`,
        iconSize:[34,34],
        iconAnchor:[17,17]
    });

    if(marqueurSelection){
        marqueurSelection.setLatLng([lieu.latitude, lieu.longitude]);
        marqueurSelection.setIcon(icone);
    }else{
        marqueurSelection = L.marker(
            [lieu.latitude, lieu.longitude],
            { icon: icone, interactive:false, zIndexOffset:-100 }
        ).addTo(carte);
    }

}

//==================================================

chargerLieux();

//==================================================

async function chargerLieux(){

    try{

        const [repLieux, repCategories] = await Promise.all([
            fetch("data/lieux.json"),
            fetch("data/categories.json")
        ]);

        if(!repLieux.ok){
            throw new Error(`Erreur HTTP ${repLieux.status} (lieux.json)`);
        }

        if(!repCategories.ok){
            throw new Error(`Erreur HTTP ${repCategories.status} (categories.json)`);
        }

        lieux = await repLieux.json();

        // Les lieux marqués comme événement temporaire (date de fin) et
        // déjà passés sont retirés dès le départ : ni sur la carte, ni
        // dans la liste, ni dans les compteurs.
        lieux = lieux.filter(l => !evenementExpire(l));

        const listeCategories = await repCategories.json();

        CATEGORIES = {};
        listeCategories.forEach(c=>{
            CATEGORIES[c.nom] = { icone: c.icone, couleur: c.couleur };
        });

        lieux.sort((a,b)=>a.nom.localeCompare(b.nom, "fr"));

        creerCategories();

        afficher();

        afficherEcranAccueil();

    }catch(erreur){

        console.error("Impossible de charger les données :", erreur);

        liste.innerHTML = `
            <p style="color:#c0392b;padding:8px;">
                Impossible de charger les lieux ou les catégories.
                Vérifiez votre connexion ou réessayez plus tard.
            </p>
        `;

        compteur.textContent = "Erreur de chargement";

    }

}

//==================================================

function creerCategories(){

    cboCategorie.innerHTML="";

    cboCategorie.add(new Option(`Toutes les catégories (${lieux.length})`,"Toutes"));

    [...new Set(lieux.map(l=>l.categorie))]
        .sort((a,b)=>a.localeCompare(b, "fr"))
        .forEach(c=>{

            const nb = lieux.filter(l=>l.categorie===c).length;

            cboCategorie.add(new Option(`${c} (${nb})`,c));

        });

    creerSousCategories();

}

// Peuple le menu "Sous-catégorie" selon la catégorie actuellement
// sélectionnée. Ne montre que les sous-catégories réellement utilisées
// par au moins un lieu (avec leur nombre), et masque le menu entier
// s'il n'y en a aucune ou si "Toutes les catégories" est sélectionné.
function creerSousCategories(){

    const categorieChoisie = cboCategorie.value;

    if(categorieChoisie==="Toutes"){
        cboSousCategorie.hidden = true;
        return;
    }

    const lieuxDeLaCategorie = lieux.filter(l => l.categorie===categorieChoisie);

    const sousCategories = [...new Set(
        lieuxDeLaCategorie.map(l => l.sousCategorie).filter(sc => sc)
    )];

    if(sousCategories.length===0){
        cboSousCategorie.hidden = true;
        cboSousCategorie.value = "Toutes";
        return;
    }

    cboSousCategorie.hidden = false;
    cboSousCategorie.innerHTML = "";

    cboSousCategorie.add(new Option(
        `Toutes les sous-catégories (${lieuxDeLaCategorie.length})`,
        "Toutes"
    ));

    sousCategories
        .sort((a,b)=>a.localeCompare(b,"fr"))
        .forEach(sc=>{

            const nb = lieuxDeLaCategorie.filter(l => l.sousCategorie===sc).length;

            cboSousCategorie.add(new Option(`${sc} (${nb})`, sc));

        });

}

//==================================================

function afficher(){

    groupe.clearLayers();

    liste.innerHTML="";

    const texte = txtRecherche.value.trim().toLowerCase();

    const categorie = cboCategorie.value;
    const sousCategorie = cboSousCategorie.hidden ? "Toutes" : cboSousCategorie.value;

    const resultat = lieux.filter(l=>{

        const okCategorie =
            categorie==="Toutes" ||
            l.categorie===categorie;

        if(!okCategorie) return false;

        const okSousCategorie =
            sousCategorie==="Toutes" ||
            l.sousCategorie===sousCategorie;

        if(!okSousCategorie) return false;

        if(texte===""){
            return true;
        }

        const champs = [l.nom, l.adresse, l.description];

        return champs.some(champ =>
            (champ ?? "").toLowerCase().includes(texte)
        );

    });

    compteur.textContent =
        resultat.length + (resultat.length>1 ? " lieux" : " lieu");

    let lieuSelectionneEncoreVisible = false;

    resultat.forEach(lieu=>{

        const marker = L.marker(
            [lieu.latitude, lieu.longitude],
            { icon: creerIcone(lieu) }
        ).addTo(groupe);

        marker.bindPopup(creerPopup(lieu));

        marker.on("click", ()=>{
            placerMarqueurSelection(lieu);
        });

        ajouterDansListe(lieu,marker);

        if(lieu.id===idLieuSelectionne){
            lieuSelectionneEncoreVisible = true;
        }

    });

    // Si le lieu sélectionné n'est plus dans les résultats filtrés,
    // on nettoie la sélection et la fiche pour éviter un état incohérent.
    if(!lieuSelectionneEncoreVisible && idLieuSelectionne!==null){

        idLieuSelectionne = null;
        elementSelectionne = null;

        if(marqueurSelection){
            carte.removeLayer(marqueurSelection);
            marqueurSelection = null;
        }

        ficheLieu.innerHTML = "<p>Sélectionnez un lieu sur la carte ou dans la liste.</p>";

    }

    if(resultat.length){

        carte.fitBounds(
            groupe.getBounds(),
            {
                padding:[40,40],
                maxZoom:15
            }
        );

    }

}

//==================================================

function creerPopup(lieu){

    let html = `<b>${rendreIconeLieu(lieu)} ${echapperHtml(lieu.nom)}</b><br>`;

    html += `<span style="color:#666;font-size:12px;">${echapperHtml(lieu.categorie)}${lieu.sousCategorie ? ` › ${echapperHtml(lieu.sousCategorie)}` : ""}</span><br><br>`;

    const ouvert = estOuvertMaintenant(lieu.horaires);

    if(ouvert===true)
        html += `<span style="color:#1e7e34;font-weight:bold;">🟢 Ouvert maintenant</span><br><br>`;
    else if(ouvert===false)
        html += `<span style="color:#c0392b;font-weight:bold;">🔴 Fermé actuellement</span><br><br>`;

    if(lieu.estEvenement){

        const periode = lieu.dateDebut===lieu.dateFin
            ? formaterDateFrLongue(lieu.dateDebut)
            : `Du ${formaterDateFrLongue(lieu.dateDebut)} au ${formaterDateFrLongue(lieu.dateFin)}`;

        html += `📅 ${echapperHtml(periode)}<br>`;

        if(lieu.horairesEvenement){
            html += `🕒 ${echapperHtml(lieu.horairesEvenement)}<br>`;
        }

        html += `<br>`;

    }

    html += `📍 ${echapperHtml(lieu.adresse)}`;

    if(lieu.telephone)
        html += `<br>☎ ${echapperHtml(lieu.telephone)}`;

    if(lieu.site)
        html += `<br><a href="${echapperHtml(lieu.site)}" target="_blank" rel="noopener noreferrer">🌍 Site internet</a>`;

    if(lieu.description)
        html += `<br><br>${echapperHtml(lieu.description)}`;

    return html;

}

//==================================================

function ajouterDansListe(lieu,marker){

    const div=document.createElement("div");

    div.className="lieu";
    div.tabIndex = 0;
    div.setAttribute("role","button");
    div.setAttribute("aria-label", `${lieu.categorie}${lieu.sousCategorie ? ", " + lieu.sousCategorie : ""} : ${lieu.nom}`);

    if(lieu.id===idLieuSelectionne){
        div.style.background="#d9ebff";
        elementSelectionne = div;
    }

    div.innerHTML=
    `
        <div class="nomLieu">

            ${rendreIconeLieu(lieu)} ${echapperHtml(lieu.nom)}

        </div>

        <div class="categorieLieu">

            ${echapperHtml(lieu.categorie)}${lieu.sousCategorie ? ` › ${echapperHtml(lieu.sousCategorie)}` : ""}

        </div>
    `;

    const selectionner = () => {

        if(elementSelectionne){
            elementSelectionne.style.background="white";
        }

        div.style.background="#d9ebff";
        elementSelectionne=div;
        idLieuSelectionne=lieu.id;

        afficherFiche(lieu);
        placerMarqueurSelection(lieu);

        // zoomToShowLayer dézoome/zoome et déplace la carte autant que
        // nécessaire pour faire sortir le marqueur de son éventuelle
        // "bulle" de regroupement avant d'ouvrir son popup — sans ça,
        // openPopup() ne fait rien sur un marqueur caché dans un cluster.
        groupe.zoomToShowLayer(marker, ()=>{

            // zoomToShowLayer peut avoir zoomé jusqu'au maximum (19) pour
            // sortir le marqueur de son cluster ; on plafonne l'affichage
            // automatique à 18 pour rester lisible, tout en laissant
            // l'utilisateur zoomer manuellement plus loin s'il le souhaite.
            const zoomCible = Math.min(Math.max(carte.getZoom(), 17), 18);

            carte.setView([lieu.latitude, lieu.longitude], zoomCible);

            marker.openPopup();

        });

    };

    div.addEventListener("click", selectionner);

    // Accessibilité clavier : Entrée / Espace déclenchent la sélection
    div.addEventListener("keydown", (e)=>{

        if(e.key==="Enter" || e.key===" "){
            e.preventDefault();
            selectionner();
        }

    });

    liste.appendChild(div);

}

//==================================================

function creerIcone(lieu){

    const valeur = iconeLieu(lieu);

    const contenu = estImageIcone(valeur)
        ? `<img src="${valeur}" style="width:14px;height:14px;object-fit:cover;border-radius:50%;">`
        : `<span style="font-size:11px;line-height:1;">${echapperHtml(valeur)}</span>`;

    return L.divIcon({

        className: "",

        html: `
            <div
                style="
                    width:22px;
                    height:22px;
                    border-radius:50%;
                    background:${couleurLieu(lieu)};
                    border:3px solid white;
                    box-shadow:0 0 6px rgba(0,0,0,.35);
                    display:flex;
                    align-items:center;
                    justify-content:center;
                ">
                ${contenu}
            </div>
        `,

        iconSize:[22,22],
        iconAnchor:[11,11],
        popupAnchor:[0,-10]

    });

}

//==================================================
// Écouteurs
//==================================================

const afficherDebounce = debounce(afficher, 200);

txtRecherche.addEventListener("input", ()=>{

    btnEffacerRecherche.hidden = txtRecherche.value.length===0;

    afficherDebounce();

});

btnEffacerRecherche.addEventListener("click", ()=>{

    txtRecherche.value = "";
    btnEffacerRecherche.hidden = true;
    txtRecherche.focus();

    afficher();

});

cboCategorie.addEventListener("change", ()=>{
    creerSousCategories();
    afficher();
});

cboSousCategorie.addEventListener("change", afficher);
