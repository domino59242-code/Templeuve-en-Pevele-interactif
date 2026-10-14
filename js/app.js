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

// Transforme un numéro affiché ("03 20 00 00 00") en lien tel: valide
// (ne garde que les chiffres et le + éventuel, sans changer l'affichage)
function lienTelephone(numero){
    return "tel:" + numero.replace(/[^\d+]/g, "");
}

// Lien vers un itinéraire Google Maps à partir des coordonnées précises
// du lieu (plus fiable qu'une recherche sur le texte de l'adresse)
function lienItineraire(lieu){
    return `https://www.google.com/maps/search/?api=1&query=${lieu.latitude},${lieu.longitude}`;
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

// Un créneau dont le début est égal à la fin (ex. "00:00-00:00") signifie
// "non renseigné / fermé" : on l'ignore partout.
function creneauxValides(creneaux){

    return (creneaux ?? []).filter(c=>{
        const [debut, fin] = c.split("-");
        return debut && fin && debut!==fin;
    });

}

// Un lieu "a des horaires" seulement si au moins un jour a un créneau
function aDesHoraires(horaires){

    if(!horaires) return false;

    return JOURS_SEMAINE.some(j => creneauxValides(horaires[j.cle]).length>0);

}

// Convertit un créneau "HH:MM-HH:MM" en minutes depuis minuit.
// - "23:59" comme heure de fin compte jusqu'à minuit (créneau 00:00-23:59 =
//   ouvert 24h/24).
// - Si la fin est avant le début (ex. "18:00-02:00", ou "20:00-00:00"),
//   le créneau passe minuit : la fin est comptée le lendemain (> 1440).
function bornesCreneau(creneau){

    const [debut, fin] = creneau.split("-");
    const [hD,mD] = debut.split(":").map(Number);
    const [hF,mF] = fin.split(":").map(Number);

    const minDebut = hD*60+mD;
    let minFin = hF*60+mF;

    if(fin==="23:59"){
        minFin = 24*60;
    }else if(minFin<minDebut){
        minFin += 24*60;
    }

    return { minDebut, minFin };

}

// Créneau couvrant toute la journée, affiché "24h/24"
function estCreneau24h(creneau){
    return creneau==="00:00-23:59";
}

function texteCreneau(creneau){

    return estCreneau24h(creneau)
        ? "24h/24"
        : creneau.replace("-", " - ");

}

// Détermine si un lieu est ouvert à l'instant présent (heure du navigateur) :
// true si ouvert, false si fermé, null si aucun horaire n'est renseigné
function estOuvertMaintenant(horaires){

    if(!aDesHoraires(horaires)) return null;

    const maintenant = new Date();

    // getDay() renvoie 0 pour dimanche ; on décale pour retomber sur
    // notre tableau JOURS_SEMAINE qui commence le lundi (index 0)
    const indexJour = (maintenant.getDay()+6)%7;
    const indexHier = (indexJour+6)%7;

    const minutesActuelles = maintenant.getHours()*60 + maintenant.getMinutes();

    // Créneaux du jour (un créneau qui passe minuit est ouvert jusqu'à 24h00)
    const ouvertAujourdhui = creneauxValides(horaires[JOURS_SEMAINE[indexJour].cle])
        .some(creneau=>{
            const { minDebut, minFin } = bornesCreneau(creneau);
            return minutesActuelles>=minDebut && minutesActuelles<minFin;
        });

    if(ouvertAujourdhui) return true;

    // Suite après minuit d'un créneau commencé la veille
    return creneauxValides(horaires[JOURS_SEMAINE[indexHier].cle])
        .some(creneau=>{
            const { minFin } = bornesCreneau(creneau);
            return minFin>24*60 && minutesActuelles<minFin-24*60;
        });

}

// Construit le HTML du tableau hebdomadaire des horaires
function tableauHorairesHtml(horaires){

    const indexAujourdhui = (new Date().getDay()+6)%7;

    const lignes = JOURS_SEMAINE.map((jour,index)=>{

        const creneaux = creneauxValides(horaires[jour.cle]);

        const texte = creneaux.length>0
            ? creneaux.map(c=>echapperHtml(texteCreneau(c))).join(", ")
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
//
// L'accueil est une vue à part entière : un clic sur un bouton de
// catégorie ouvre le plan filtré sur cette catégorie, et la flèche
// "Accueil" du plan (ou le bouton Retour du téléphone) ramène ici.
//==================================================

// Nom de la catégorie utilisée par les événements dans lieux.json
const CATEGORIE_EVENEMENTS = "Événement";

const ecranAccueil = document.getElementById("ecranAccueil");
const grilleCategoriesAccueil = document.getElementById("grilleCategoriesAccueil");
const messageAccueil = document.getElementById("messageAccueil");
const blocVedetteAccueil = document.getElementById("blocVedetteAccueil");
const selectVedetteAccueil = document.getElementById("selectVedetteAccueil");

let donneesChargees = false;

function afficherMessageAccueil(texte){
    messageAccueil.textContent = texte;
    messageAccueil.hidden = !texte;
}

function nombreDeLieux(categorie){
    return categorie==="Toutes"
        ? lieux.length
        : lieux.filter(l => l.categorie===categorie).length;
}

function texteNombreLieux(n){
    return `${n} lieu${n>1 ? "x" : ""}`;
}

// Affiche l'accueil (retour depuis le plan)
function afficherAccueil(){

    carte.closePopup();
    fermerPanneauDetailsMobile(true);

    afficherMessageAccueil("");
    selectVedetteAccueil.selectedIndex = 0;

    ecranAccueil.classList.remove("masque");
    ecranAccueil.scrollTop = 0;

}

// Masque l'accueil pour montrer le plan
function masquerAccueil(){

    ecranAccueil.classList.add("masque");
    carte.invalidateSize();

}

// Passe de l'accueil au plan, en ajoutant une étape dans l'historique
// du navigateur pour que le bouton Retour du téléphone revienne à l'accueil
function ouvrirCarte(){

    masquerAccueil();
    history.pushState({ vue:"carte" }, "");

}

// Flèche du plan : revient à l'accueil
function retourAccueil(){

    if(history.state && history.state.vue==="carte"){
        history.back();
    }else{
        afficherAccueil();
    }

}

history.replaceState({ vue:"accueil" }, "");

window.addEventListener("popstate", (e)=>{

    if(e.state && e.state.vue==="carte"){
        masquerAccueil();
    }else{
        afficherAccueil();
    }

});

// Ouvre le plan en n'affichant que la catégorie choisie ("Toutes" = tout)
function ouvrirCarteCategorie(categorie, options = {}){

    afficherMessageAccueil("");

    // Sauf demande contraire, on repart de filtres rapides désactivés
    if(!options.conserverFiltres){
        filtreOuvert = false;
        desactiverProximite();
        majPucesFiltres();
    }

    txtRecherche.value = "";
    btnEffacerRecherche.hidden = true;

    cboCategorie.value = categorie;
    creerSousCategories();
    afficher();

    ouvrirCarte();

}

// Construit les boutons de l'accueil une fois les données chargées
function initialiserAccueil(){

    donneesChargees = true;

    // Compteurs des deux boutons principaux
    document.getElementById("nbAccueilToutes").textContent = texteNombreLieux(lieux.length);

    const nbEvenements = nombreDeLieux(CATEGORIE_EVENEMENTS);

    document.getElementById("nbAccueilEvenements").textContent =
        nbEvenements===0
            ? "Aucun pour l'instant"
            : `${nbEvenements} à venir`;

    // Un bouton par catégorie réellement utilisée (hors événements, qui
    // ont leur propre bouton), dans l'ordre alphabétique
    const noms = [...new Set(lieux.map(l => l.categorie))]
        .filter(nom => nom && nom!==CATEGORIE_EVENEMENTS)
        .sort((a,b) => a.localeCompare(b, "fr"));

    grilleCategoriesAccueil.innerHTML = "";

    noms.forEach(nom=>{

        const bouton = document.createElement("button");
        bouton.type = "button";
        bouton.className = "btnAccueil btnCategorieAccueil";
        bouton.dataset.categorie = nom;

        const pastille = document.createElement("span");
        pastille.className = "pastilleAccueil";
        pastille.setAttribute("aria-hidden", "true");
        pastille.style.background = couleurCategorie(nom);
        pastille.innerHTML = rendreIcone(nom);

        const libelle = document.createElement("span");
        libelle.className = "libelleAccueil";
        libelle.textContent = nom;

        const nb = document.createElement("span");
        nb.className = "nbAccueil";
        nb.textContent = texteNombreLieux(nombreDeLieux(nom));
        libelle.appendChild(nb);

        bouton.append(pastille, libelle);

        bouton.addEventListener("click", ()=> ouvrirCarteCategorie(nom));

        grilleCategoriesAccueil.appendChild(bouton);

    });

    // Prochains événements en cartes ; le menu "À la une" ne sert plus
    // que de solution de repli quand aucun événement n'est à venir.
    if(construireEvenementsAccueil()>0){
        blocVedetteAccueil.classList.add("masque");
        return;
    }

    // Menu "À la une". Pas de limite de nombre : un menu déroulant reste
    // utilisable même avec beaucoup de lieux mis en vedette.
    const lieuxVedette = lieux.filter(l=>l.vedette);

    // Si aucun lieu n'est marqué "en vedette", on en propose quand même
    // quelques-uns au hasard pour que le menu ne soit pas vide
    const lieuxAffiches = lieuxVedette.length>0
        ? lieuxVedette
        : [...lieux].sort(()=>Math.random()-0.5).slice(0,5);

    if(lieuxAffiches.length===0){
        blocVedetteAccueil.classList.add("masque");
        return;
    }

    blocVedetteAccueil.classList.remove("masque");

    selectVedetteAccueil.innerHTML = `<option value="" selected disabled>Choisir dans la liste…</option>` +
        lieuxAffiches.map(lieu => `
            <option value="${lieu.id}">
                ${echapperHtml(iconeLieu(lieu))} ${echapperHtml(lieu.nom)} — ${echapperHtml(lieu.categorie)}
            </option>
        `).join("");

}

// Ouvre le plan centré sur un lieu précis, avec sa fiche
function ouvrirLieuDepuisAccueil(lieu, categorie){

    ouvrirCarteCategorie(categorie);

    idLieuSelectionne = lieu.id;
    placerMarqueurSelection(lieu);

    afficherFiche(lieu);
    centrerSurLieu(lieu, 17);

}

selectVedetteAccueil.addEventListener("change", ()=>{

    const lieu = lieux.find(l => l.id===Number(selectVedetteAccueil.value));

    if(!lieu) return;

    // Plan complet pour que le lieu choisi soit forcément visible
    ouvrirLieuDepuisAccueil(lieu, "Toutes");

});

const MOIS_COURTS = ["janv.","févr.","mars","avr.","mai","juin","juil.","août","sept.","oct.","nov.","déc."];

// Affiche les 3 prochains événements (en cours ou à venir) sur l'accueil
function construireEvenementsAccueil(){

    const bloc = document.getElementById("blocEvenementsAccueil");
    const conteneur = document.getElementById("listeEvenementsAccueil");

    const evenements = lieux
        .filter(l => l.estEvenement)
        .sort((a,b) => (a.dateDebut || a.dateFin || "").localeCompare(b.dateDebut || b.dateFin || ""))
        .slice(0,3);

    conteneur.innerHTML = "";
    bloc.hidden = evenements.length===0;

    evenements.forEach(evt=>{

        const bouton = document.createElement("button");
        bouton.type = "button";
        bouton.className = "carteEvenementAccueil";

        const iso = evt.dateDebut || evt.dateFin;
        const [, mois, jour] = (iso || "").split("-").map(Number);

        const date = document.createElement("span");
        date.className = "dateEvenementAccueil";
        date.setAttribute("aria-hidden", "true");
        date.innerHTML = iso
            ? `<span class="jourEvenement">${jour}</span><span class="moisEvenement">${MOIS_COURTS[mois-1]}</span>`
            : "🎉";

        const texte = document.createElement("span");
        texte.className = "texteEvenementAccueil";

        const nom = document.createElement("span");
        nom.className = "nomEvenementAccueil";
        nom.textContent = evt.nom;

        const info = document.createElement("span");
        info.className = "infoEvenementAccueil";
        info.textContent = [
            evt.dateFin ? texteJoursRestants(evt) : "",
            evt.horairesEvenement
        ].filter(Boolean).join(" · ");

        texte.append(nom, info);
        bouton.append(date, texte);

        bouton.setAttribute(
            "aria-label",
            `${evt.nom}${iso ? ", " + formaterDateFrLongue(iso) : ""}`
        );

        bouton.addEventListener("click", ()=> ouvrirLieuDepuisAccueil(evt, evt.categorie));

        conteneur.appendChild(bouton);

    });

    return evenements.length;

}

document.getElementById("btnAccueilToutes").addEventListener("click", ()=>{
    ouvrirCarteCategorie("Toutes");
});

document.getElementById("btnAccueilOuvert").addEventListener("click", ()=>{

    filtreOuvert = true;
    majPucesFiltres();

    ouvrirCarteCategorie("Toutes", { conserverFiltres:true });

});

document.getElementById("btnAccueilPres").addEventListener("click", async ()=>{

    afficherMessageAccueil("Recherche de votre position…");

    try{

        await activerProximite();

        filtreOuvert = false;
        majPucesFiltres();

        ouvrirCarteCategorie("Toutes", { conserverFiltres:true });

    }catch(erreur){
        afficherMessageAccueil(erreur.message);
    }

});

document.getElementById("btnAccueilEvenements").addEventListener("click", ()=>{

    if(!donneesChargees){
        afficherMessageAccueil("Chargement en cours, merci de patienter…");
        return;
    }

    if(nombreDeLieux(CATEGORIE_EVENEMENTS)===0){
        afficherMessageAccueil("Aucun événement à venir pour le moment.");
        return;
    }

    ouvrirCarteCategorie(CATEGORIE_EVENEMENTS);

});

//==================================================
// Accessibilité : taille du texte et contraste élevé
//
// Les préférences sont mémorisées dans le navigateur (localStorage) et
// réappliquées automatiquement à chaque visite.
//==================================================

const CLE_PREFS_ACCESSIBILITE = "templeuve_prefs_accessibilite";

// Deux tailles réduites ont été ajoutées (0.8 et 0.9), utiles sur les
// petits écrans de téléphone où le texte par défaut peut sembler trop
// grand. L'échelle "1" (taille normale) reste la valeur par défaut.
const ECHELLES_POLICE = [0.8, 0.9, 1, 1.15, 1.3, 1.45];
const INDEX_ECHELLE_DEFAUT = 2; // correspond à la valeur 1 (100%)

function chargerPrefsAccessibilite(){

    try{
        const brut = localStorage.getItem(CLE_PREFS_ACCESSIBILITE);
        return brut ? JSON.parse(brut) : { indexEchelle: INDEX_ECHELLE_DEFAUT, contraste: false };
    }catch(erreur){
        return { indexEchelle: INDEX_ECHELLE_DEFAUT, contraste: false };
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
        prefs.indexEchelle = INDEX_ECHELLE_DEFAUT;
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

// Sur mobile, la fiche détail est temporairement déplacée en dehors de
// #application (voir plus bas) pour échapper au CSS "zoom" posé sur cet
// élément par la fonctionnalité d'accessibilité (Chrome positionne les
// éléments "position:fixed" à l'intérieur d'un ancêtre zoomé par rapport
// à cet ancêtre plutôt que par rapport à l'écran réel — d'où un plein
// écran mobile mal positionné sans ce contournement). On mémorise ici sa
// position d'origine pour pouvoir l'y remettre une fois refermée.
const sectionDetails = document.getElementById("sectionDetails");
const parentOrigineDetails = sectionDetails.parentNode;
const referenceOrigineDetails = sectionDetails.nextSibling;

// Lieu actuellement affiché dans la fiche, et minuterie qui remet la fiche
// dans la barre latérale après sa fermeture (annulée si on la rouvre vite)
let lieuFiche = null;
let minuterieReplacement = null;

function estMobile(){
    return window.matchMedia("(max-width:700px)").matches;
}

const carte = L.map("map", { zoomControl:false }).setView(CENTRE_VILLE, ZOOM_DEPART);

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

// Flèche de retour vers l'écran d'accueil, placée en haut à gauche du plan
// (au-dessus des boutons de zoom)
const ControleAccueil = L.Control.extend({

    options: { position:"topleft" },

    onAdd: function(){

        const conteneur = L.DomUtil.create("div", "leaflet-control controleAccueil");

        const bouton = L.DomUtil.create("button", "btnRetourAccueil", conteneur);
        bouton.type = "button";
        bouton.title = "Retour à l'accueil";
        bouton.setAttribute("aria-label", "Retour à l'accueil");
        bouton.innerHTML = `
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
                <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20z" fill="currentColor"/>
            </svg>
            <span>Accueil</span>
        `;

        L.DomEvent.disableClickPropagation(conteneur);
        L.DomEvent.on(bouton, "click", retourAccueil);

        return conteneur;

    }

});

carte.addControl(new ControleAccueil());
L.control.zoom({ position:"topleft" }).addTo(carte);

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
const btnFiltreOuvert = document.getElementById("btnFiltreOuvert");
const btnFiltrePres = document.getElementById("btnFiltrePres");
const noteGeoloc = document.getElementById("noteGeoloc");

//==================================================
// Filtres rapides : "Ouvert maintenant" et "Près de moi"
//==================================================

let filtreOuvert = false;
// Position de l'utilisateur ({lat, lng}) quand "Près de moi" est actif
let positionUtilisateur = null;
let marqueurPosition = null;

// Au-delà de cette distance au centre de Templeuve, on ne recadre pas la
// carte sur l'utilisateur (il consulte probablement l'appli de loin)
const DISTANCE_MAX_RECADRAGE_M = 10000;

function distanceMetres(a, b){

    const R = 6371000;
    const rad = x => x*Math.PI/180;

    const dLat = rad(b.lat-a.lat);
    const dLng = rad(b.lng-a.lng);

    const h = Math.sin(dLat/2)**2 +
        Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(dLng/2)**2;

    return 2*R*Math.asin(Math.sqrt(h));

}

function texteDistance(metres){

    if(metres<1000){
        return `${Math.max(10, Math.round(metres/10)*10)} m`;
    }

    return `${(metres/1000).toFixed(1).replace(".", ",")} km`;

}

function afficherNoteGeoloc(texte){

    noteGeoloc.textContent = texte;
    noteGeoloc.hidden = !texte;

}

function majPucesFiltres(){

    btnFiltreOuvert.setAttribute("aria-pressed", String(filtreOuvert));
    btnFiltrePres.setAttribute("aria-pressed", String(positionUtilisateur!==null));

}

function demanderPosition(){

    return new Promise((resolve, reject)=>{

        if(!navigator.geolocation){
            reject(new Error("La localisation n'est pas disponible sur cet appareil."));
            return;
        }

        navigator.geolocation.getCurrentPosition(
            p => resolve({ lat:p.coords.latitude, lng:p.coords.longitude }),
            err => reject(new Error(
                err.code===1
                    ? "Localisation refusée. Autorisez-la dans les réglages de votre navigateur ou de l'application."
                    : "Position introuvable. Réessayez dans un instant."
            )),
            { enableHighAccuracy:true, timeout:10000, maximumAge:60000 }
        );

    });

}

// Active "Près de moi" (lève une erreur si la position est indisponible)
async function activerProximite(){

    positionUtilisateur = await demanderPosition();

    if(marqueurPosition){
        marqueurPosition.setLatLng([positionUtilisateur.lat, positionUtilisateur.lng]);
    }else{
        marqueurPosition = L.circleMarker(
            [positionUtilisateur.lat, positionUtilisateur.lng],
            {
                radius:9,
                color:"white",
                weight:3,
                fillColor:"#2c7be5",
                fillOpacity:1,
                interactive:false
            }
        ).addTo(carte);
    }

    const loin = distanceMetres(
        positionUtilisateur,
        { lat:CENTRE_VILLE[0], lng:CENTRE_VILLE[1] }
    ) > DISTANCE_MAX_RECADRAGE_M;

    afficherNoteGeoloc(
        loin
            ? "Vous êtes loin de Templeuve : les distances sont calculées depuis votre position."
            : "Lieux classés du plus proche au plus éloigné."
    );

    majPucesFiltres();

}

function desactiverProximite(){

    positionUtilisateur = null;

    if(marqueurPosition){
        carte.removeLayer(marqueurPosition);
        marqueurPosition = null;
    }

    afficherNoteGeoloc("");
    majPucesFiltres();

}

btnFiltreOuvert.addEventListener("click", ()=>{

    filtreOuvert = !filtreOuvert;
    majPucesFiltres();
    afficher();

});

btnFiltrePres.addEventListener("click", async ()=>{

    if(positionUtilisateur){
        desactiverProximite();
        afficher();
        return;
    }

    afficherNoteGeoloc("Recherche de votre position…");
    btnFiltrePres.disabled = true;

    try{
        await activerProximite();
        afficher();
    }catch(erreur){
        afficherNoteGeoloc(erreur.message);
    }finally{
        btnFiltrePres.disabled = false;
    }

});

function afficherFiche(lieu){

    const ouvert = estOuvertMaintenant(lieu.horaires);

    ficheLieu.innerHTML = `

        <button type="button" class="btnRetourListe" id="btnRetourListe">
            ✕ Fermer
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

                📍 <a href="${lienItineraire(lieu)}" target="_blank" rel="noopener noreferrer">${echapperHtml(lieu.adresse)}</a>

            </div>

            ${
                lieu.telephone
                ?
                `<div class="ficheLigne">☎ <a href="${lienTelephone(lieu.telephone)}">${echapperHtml(lieu.telephone)}</a></div>`
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

    lieuFiche = lieu;
    ficheLieu.scrollTop = 0;

    if(estMobile()){

        // Sur mobile, la fiche s'ouvre en bas d'écran (voir CSS) : on la
        // déplace d'abord au niveau du <body> (voir explication plus haut)
        clearTimeout(minuterieReplacement);

        if(sectionDetails.parentNode!==document.body){
            document.body.appendChild(sectionDetails);
        }

        const dejaOuverte = document.body.classList.contains("fiche-ouverte");

        // La liste est masquée pendant que la fiche est ouverte : la carte
        // occupe alors tout l'écran derrière la fiche
        document.body.classList.add("fiche-ouverte");
        sectionDetails.classList.add("actif");

        if(!dejaOuverte){
            sectionDetails.classList.remove("deploye");
            mettreAJourPoignee();
            carte.invalidateSize({ animate:false });
        }

        centrerSurLieu(lieu, carte.getZoom());

    }else{

        sectionDetails.classList.add("actif");

    }

    // Fil d'Ariane : revenir à la liste complète ou filtrer sur la catégorie
    document.getElementById("filArianeTous").addEventListener("click", ()=>{
        txtRecherche.value = "";
        btnEffacerRecherche.hidden = true;
        cboCategorie.value = "Toutes";
        creerSousCategories();
        afficher();
        ficheLieu.innerHTML = "<p>Sélectionnez un lieu sur la carte ou dans la liste.</p>";
        fermerPanneauDetailsMobile();
    });

    document.getElementById("filArianeCategorie").addEventListener("click", ()=>{
        cboCategorie.value = lieu.categorie;
        creerSousCategories();
        afficher();
        fermerPanneauDetailsMobile();
    });

    if(lieu.sousCategorie){

        document.getElementById("filArianeSousCategorie").addEventListener("click", ()=>{
            cboCategorie.value = lieu.categorie;
            creerSousCategories();
            cboSousCategorie.value = lieu.sousCategorie;
            afficher();
            fermerPanneauDetailsMobile();
        });

    }

    // Bouton "Fermer" (visible uniquement sur petit écran, voir CSS)
    document.getElementById("btnRetourListe").addEventListener("click", ()=>{
        fermerPanneauDetailsMobile();
    });

}

// Referme la fiche détail (sans effet visible sur desktop, où elle reste
// dans la barre latérale)
function fermerPanneauDetailsMobile(sansDefilement){

    const etaitOuverte = document.body.classList.contains("fiche-ouverte");

    sectionDetails.classList.remove("actif", "deploye");
    sectionDetails.style.transform = "";
    mettreAJourPoignee();

    // La liste réapparaît et la carte retrouve sa hauteur d'origine
    document.body.classList.remove("fiche-ouverte");

    if(etaitOuverte){
        carte.invalidateSize({ animate:false });
    }

    // Remet la fiche à sa place normale dans la barre latérale une fois
    // l'animation de fermeture terminée (voir le CSS), pour qu'elle
    // redevienne inline si l'écran repasse en desktop entre-temps
    clearTimeout(minuterieReplacement);

    minuterieReplacement = setTimeout(()=>{

        if(sectionDetails.parentNode===document.body){
            parentOrigineDetails.insertBefore(sectionDetails, referenceOrigineDetails);
        }

    }, 350);

    // Remet la liste bien en vue une fois le panneau refermé
    if(sansDefilement!==true){
        liste.scrollIntoView({behavior:"smooth", block:"start"});
    }

}

//==================================================
// Fiche en bas d'écran (mobile) : deux hauteurs, "réduite" (la carte reste
// visible au-dessus) et "déployée" (quasi plein écran). On passe de l'une à
// l'autre en tapant ou en faisant glisser la poignée, ou en faisant glisser
// la fiche réduite vers le haut ; un glissement vers le bas la referme.
//==================================================

const poigneePanneau = document.getElementById("poigneePanneau");
const btnFermerPanneau = document.getElementById("btnFermerPanneau");

// Part de la hauteur de l'écran occupée par la fiche réduite (voir le CSS)
const PART_FICHE_REDUITE = 0.46;

function mettreAJourPoignee(){
    poigneePanneau.setAttribute(
        "aria-expanded",
        String(sectionDetails.classList.contains("deploye"))
    );
}

// Centre la carte sur un lieu. Quand la fiche réduite masque le bas de la
// carte, on remonte le lieu au milieu de la partie encore visible.
function centrerSurLieu(lieu, zoom){

    carte.setView([lieu.latitude, lieu.longitude], zoom, { animate:false });

    if(
        estMobile() &&
        sectionDetails.classList.contains("actif") &&
        !sectionDetails.classList.contains("deploye")
    ){
        carte.panBy([0, window.innerHeight*PART_FICHE_REDUITE/2], { animate:false });
    }

}

function definirPanneauDeploye(deploye){

    sectionDetails.classList.toggle("deploye", deploye);
    mettreAJourPoignee();

    // Revenu à la hauteur réduite : on recentre le lieu dans la partie visible
    if(!deploye && lieuFiche){
        centrerSurLieu(lieuFiche, carte.getZoom());
    }

}

// Décalage vertical (px) du panneau dans son état actuel
function decalagePanneauActuel(){

    return sectionDetails.classList.contains("deploye")
        ? 0
        : sectionDetails.offsetHeight - window.innerHeight*PART_FICHE_REDUITE;

}

let glissement = null;

sectionDetails.addEventListener("pointerdown", (e)=>{

    if(!estMobile() || !sectionDetails.classList.contains("actif")) return;
    if(e.target.closest("#btnFermerPanneau")) return;

    const surPoignee = !!e.target.closest("#poigneePanneau");
    const deploye = sectionDetails.classList.contains("deploye");

    // Déployée, le contenu défile normalement : seule la poignée fait glisser
    if(deploye && !surPoignee) return;

    glissement = {
        id: e.pointerId,
        y0: e.clientY,
        t0: performance.now(),
        depart: decalagePanneauActuel(),
        deplace: false,
        surPoignee
    };

});

sectionDetails.addEventListener("pointermove", (e)=>{

    if(!glissement) return;

    const dy = e.clientY - glissement.y0;

    if(!glissement.deplace){

        // Petit seuil pour ne pas confondre un tap avec un glissement
        if(Math.abs(dy)<6) return;

        glissement.deplace = true;
        sectionDetails.classList.add("en-glissement");

        if(sectionDetails.setPointerCapture && glissement.id!==undefined){
            sectionDetails.setPointerCapture(glissement.id);
        }

    }

    sectionDetails.style.transform = `translateY(${Math.max(0, glissement.depart+dy)}px)`;

});

function terminerGlissement(e, annule){

    if(!glissement) return;

    const g = glissement;
    glissement = null;

    sectionDetails.classList.remove("en-glissement");
    sectionDetails.style.transform = "";

    if(annule) return;

    if(!g.deplace){

        // Simple tap sur la poignée : on bascule entre réduit et déployé
        if(g.surPoignee){
            definirPanneauDeploye(!sectionDetails.classList.contains("deploye"));
        }

        return;

    }

    const dy = e.clientY - g.y0;
    const vitesse = dy/Math.max(1, performance.now()-g.t0); // px par ms
    const deploye = sectionDetails.classList.contains("deploye");

    if(dy<-40 || vitesse<-0.5){

        if(!deploye) definirPanneauDeploye(true);

    }else if(deploye){

        if(dy>40 || vitesse>0.5) definirPanneauDeploye(false);

    }else if(dy>60 || vitesse>0.5){

        fermerPanneauDetailsMobile(true);

    }

}

sectionDetails.addEventListener("pointerup", (e)=> terminerGlissement(e, false));
sectionDetails.addEventListener("pointercancel", (e)=> terminerGlissement(e, true));

// Accessibilité clavier : Entrée / Espace sur la poignée
poigneePanneau.addEventListener("keydown", (e)=>{

    if(e.key==="Enter" || e.key===" "){
        e.preventDefault();
        definirPanneauDeploye(!sectionDetails.classList.contains("deploye"));
    }

});

btnFermerPanneau.addEventListener("click", ()=> fermerPanneauDetailsMobile());

// Si l'écran devient large (rotation, redimensionnement), la fiche
// retrouve sa place normale dans la barre latérale
window.addEventListener("resize", ()=>{

    if(!estMobile() && document.body.classList.contains("fiche-ouverte")){
        fermerPanneauDetailsMobile(true);
    }

});

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
// Lignes de la liste, retrouvées par identifiant de lieu (pour surligner
// le lieu choisi quand on touche son marqueur sur la carte)
const elementsListe = new Map();
let idLieuSelectionne = null;

// Marqueur de sélection : un repère distinct qui pulse, ajouté directement
// sur la carte (pas dans le groupe de clustering) pour toujours indiquer
// clairement l'emplacement exact du lieu choisi, quel que soit le zoom.
let marqueurSelection = null;

function placerMarqueurSelection(lieu){

    const icone = L.divIcon({
        className: "",
        html: `<div class="pulseSelection"><div class="pointSelection"></div></div>`,
        iconSize:[56,56],
        iconAnchor:[28,28]
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

        initialiserAccueil();

    }catch(erreur){

        console.error("Impossible de charger les données :", erreur);

        liste.innerHTML = `
            <p style="color:#c0392b;padding:8px;">
                Impossible de charger les lieux ou les catégories.
                Vérifiez votre connexion ou réessayez plus tard.
            </p>
        `;

        compteur.textContent = "Erreur de chargement";

        afficherMessageAccueil("Impossible de charger les données. Vérifiez votre connexion ou réessayez plus tard.");

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
    elementsListe.clear();

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

        if(filtreOuvert && estOuvertMaintenant(l.horaires)!==true) return false;

        if(texte===""){
            return true;
        }

        const champs = [l.nom, l.adresse, l.description];

        return champs.some(champ =>
            (champ ?? "").toLowerCase().includes(texte)
        );

    });

    // "Près de moi" : calcule la distance de chaque lieu et trie du plus proche au plus loin
    const distances = new Map();

    if(positionUtilisateur){

        resultat.forEach(l=>{
            distances.set(l.id, distanceMetres(positionUtilisateur, { lat:l.latitude, lng:l.longitude }));
        });

        resultat.sort((a,b)=> distances.get(a.id)-distances.get(b.id));

    }

    compteur.textContent =
        resultat.length + (resultat.length>1 ? " lieux" : " lieu");

    if(resultat.length===0){

        liste.innerHTML = `<p class="aucunResultat">${
            filtreOuvert
                ? "Aucun lieu n'est ouvert actuellement avec ces critères."
                : "Aucun lieu ne correspond à votre recherche."
        }</p>`;

    }

    let lieuSelectionneEncoreVisible = false;

    resultat.forEach(lieu=>{

        const marker = L.marker(
            [lieu.latitude, lieu.longitude],
            { icon: creerIcone(lieu) }
        ).addTo(groupe);

        // Sur mobile, la fiche en bas d'écran remplace la bulle d'information
        if(!estMobile()){
            marker.bindPopup(creerPopup(lieu));
        }

        marker.on("click", ()=>{

            placerMarqueurSelection(lieu);

            if(estMobile()){

                // Surligne aussi le lieu dans la liste, comme un clic sur la liste
                if(elementSelectionne){
                    elementSelectionne.style.background="white";
                }

                const ligne = elementsListe.get(lieu.id);

                if(ligne){
                    ligne.style.background="#d9ebff";
                    elementSelectionne = ligne;
                }

                idLieuSelectionne = lieu.id;
                afficherFiche(lieu);

            }

        });

        ajouterDansListe(lieu, marker, distances.get(lieu.id));

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

        fermerPanneauDetailsMobile(true);

    }

    if(resultat.length){

        const limites = groupe.getBounds();

        if(
            positionUtilisateur &&
            distanceMetres(positionUtilisateur, { lat:CENTRE_VILLE[0], lng:CENTRE_VILLE[1] }) <= DISTANCE_MAX_RECADRAGE_M
        ){
            limites.extend([positionUtilisateur.lat, positionUtilisateur.lng]);
        }

        carte.fitBounds(
            limites,
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

    html += `📍 <a href="${lienItineraire(lieu)}" target="_blank" rel="noopener noreferrer">${echapperHtml(lieu.adresse)}</a>`;

    if(lieu.telephone)
        html += `<br>☎ <a href="${lienTelephone(lieu.telephone)}">${echapperHtml(lieu.telephone)}</a>`;

    if(lieu.site)
        html += `<br><a href="${echapperHtml(lieu.site)}" target="_blank" rel="noopener noreferrer">🌍 Site internet</a>`;

    if(lieu.description)
        html += `<br><br>${echapperHtml(lieu.description)}`;

    return html;

}

//==================================================

function ajouterDansListe(lieu, marker, distance){

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
            ${estOuvertMaintenant(lieu.horaires)===true ? `<span class="ouvertListe">· 🟢 Ouvert</span>` : ""}

        </div>

        ${
            distance!==undefined
            ? `<div class="distanceLieu">📍 à ${texteDistance(distance)}</div>`
            : ""
        }
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

            centrerSurLieu(lieu, zoomCible);

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

    elementsListe.set(lieu.id, div);
    liste.appendChild(div);

}

//==================================================

function creerIcone(lieu){

    const valeur = iconeLieu(lieu);

    const contenu = estImageIcone(valeur)
        ? `<img src="${valeur}" alt="">`
        : `<span>${echapperHtml(valeur)}</span>`;

    // Pastille de 36 px (bordure blanche comprise) : l'icône y reste lisible
    // et assez large pour être touchée facilement du doigt
    return L.divIcon({

        className: "marqueurLieu",

        html: `<div class="pastilleMarqueur" style="background:${couleurLieu(lieu)};">${contenu}</div>`,

        iconSize:[36,36],
        iconAnchor:[18,18],
        popupAnchor:[0,-18]

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
