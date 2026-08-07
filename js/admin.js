/******************************************************************************
 * Templeuve Interactive — Administration
 *
 * Cette page charge les fichiers data/lieux.json et data/categories.json,
 * permet de les modifier en mémoire (ajout / édition / suppression), puis
 * génère un téléchargement du fichier JSON à jour. Aucune écriture n'est
 * faite sur le serveur : c'est à l'utilisateur de remplacer le fichier
 * dans le dossier data/ du projet une fois téléchargé.
 ******************************************************************************/

//==================================================
// Protection par mot de passe
//
// ATTENTION : ceci n'est PAS une vraie sécurité. Le site étant statique
// (sans serveur), ce mot de passe est visible par quiconque regarde le
// code source de la page — ça n'empêche qu'un visiteur non technique ou
// un robot ne tombe dessus par hasard. Ne stocke rien de vraiment
// confidentiel dans ce projet en te fiant à cette seule protection.
//
// Pour changer le mot de passe : remplace simplement la valeur ci-dessous.
//==================================================

const MOT_DE_PASSE_ADMIN = "Templeuve59242";

const CLE_SESSION_CONNEXION = "templeuve_admin_connecte";

function verifierConnexion(){

    return sessionStorage.getItem(CLE_SESSION_CONNEXION) === "true";

}

function afficherAdmin(){

    document.getElementById("ecranConnexion").style.display = "none";
    document.getElementById("admin").hidden = false;

    // Leaflet a besoin d'un recalcul de taille : les mini-cartes ont été
    // créées pendant que leur conteneur était caché (donc à taille nulle)
    setTimeout(()=>{
        if(typeof miniCarte!=="undefined") miniCarte.invalidateSize();
        if(typeof miniCarteEvenement!=="undefined") miniCarteEvenement.invalidateSize();
    }, 50);

}

if(verifierConnexion()){
    afficherAdmin();
}

document.getElementById("formConnexion").addEventListener("submit", (e)=>{

    e.preventDefault();

    const saisi = document.getElementById("motDePasseSaisi").value;

    if(saisi===MOT_DE_PASSE_ADMIN){

        sessionStorage.setItem(CLE_SESSION_CONNEXION, "true");
        afficherAdmin();

    }else{

        document.getElementById("erreurConnexion").hidden = false;
        document.getElementById("motDePasseSaisi").value = "";
        document.getElementById("motDePasseSaisi").focus();

    }

});

//==================================================

const CENTRE_VILLE = [50.5230, 3.1710];

const JOURS_SEMAINE = [
    { cle:"lundi",    label:"Lundi" },
    { cle:"mardi",    label:"Mardi" },
    { cle:"mercredi", label:"Mercredi" },
    { cle:"jeudi",    label:"Jeudi" },
    { cle:"vendredi", label:"Vendredi" },
    { cle:"samedi",   label:"Samedi" },
    { cle:"dimanche", label:"Dimanche" }
];

let lieux = [];
let categories = [];
let idLieuEnEdition = null;
let nomCategorieEnEdition = null;

// Sert à savoir si des changements n'ont pas encore été téléchargés
// (suivis séparément, car on peut télécharger lieux.json sans avoir
// téléchargé categories.json, ou inversement)
let dernierLieuxTelecharges = null;
let dernieresCategoriesTelechargees = null;

const CLE_SAUVEGARDE = "templeuve_admin_sauvegarde_auto";

//==================================================
// Utilitaires
//==================================================

function echapperHtml(texte){
    const div = document.createElement("div");
    div.textContent = texte ?? "";
    return div.innerHTML;
}

// Affiche une icône de catégorie, qu'elle soit un emoji (texte) ou une
// image uploadée (data-URL base64)
function rendreIcone(valeurIcone){

    if(typeof valeurIcone==="string" && valeurIcone.startsWith("data:image")){
        return `<img src="${valeurIcone}" class="icone-mini" alt="">`;
    }

    return echapperHtml(valeurIcone ?? "📍");

}

function telechargerJson(nomFichier, donnees){

    const blob = new Blob(
        [JSON.stringify(donnees, null, 4)],
        { type: "application/json" }
    );

    const url = URL.createObjectURL(blob);

    const lien = document.createElement("a");
    lien.href = url;
    lien.download = nomFichier;
    document.body.appendChild(lien);
    lien.click();
    document.body.removeChild(lien);

    URL.revokeObjectURL(url);

}

function prochainId(){
    return lieux.reduce((max,l)=>Math.max(max, l.id ?? 0), 0) + 1;
}

//==================================================
// Détection de doublons de lieux (noms identiques ou très proches)
//==================================================

// Enlève les accents, met en minuscules et normalise les espaces,
// pour comparer deux noms sans être gêné par la casse/accentuation
function normaliserTexte(texte){

    return (texte ?? "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .trim()
        .replace(/\s+/g, " ");

}

// Distance de Levenshtein : nombre minimal de modifications (ajout,
// suppression, substitution d'un caractère) pour passer d'un mot à
// l'autre. Plus le nombre est petit, plus les mots se ressemblent.
function distanceLevenshtein(a, b){

    const tableau = Array.from(
        { length: a.length+1 },
        (_, i) => [i, ...Array(b.length).fill(0)]
    );

    for(let j=0; j<=b.length; j++) tableau[0][j] = j;

    for(let i=1; i<=a.length; i++){
        for(let j=1; j<=b.length; j++){

            const cout = a[i-1]===b[j-1] ? 0 : 1;

            tableau[i][j] = Math.min(
                tableau[i-1][j]+1,
                tableau[i][j-1]+1,
                tableau[i-1][j-1]+cout
            );

        }
    }

    return tableau[a.length][b.length];

}

// Cherche un lieu existant avec un nom identique ou très proche de
// celui fourni (en ignorant le lieu en cours d'édition, le cas échéant)
function chercherLieuSimilaire(nom, idAIgnorer){

    const nomNormalise = normaliserTexte(nom);

    for(const lieu of lieux){

        if(lieu.id===idAIgnorer) continue;

        const autreNomNormalise = normaliserTexte(lieu.nom);

        if(nomNormalise===autreNomNormalise){
            return { lieu, exact:true };
        }

        const distance = distanceLevenshtein(nomNormalise, autreNomNormalise);
        const seuil = Math.max(2, Math.round(nomNormalise.length*0.15));

        if(distance<=seuil){
            return { lieu, exact:false };
        }

    }

    return null;

}

//==================================================
// Validation des coordonnées (lieu trop loin du centre-ville)
//==================================================

// Distance à vol d'oiseau en kilomètres (formule de Haversine)
function distanceKm(lat1, lon1, lat2, lon2){

    const R = 6371;
    const dLat = (lat2-lat1) * Math.PI/180;
    const dLon = (lon2-lon1) * Math.PI/180;

    const a =
        Math.sin(dLat/2)**2 +
        Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) *
        Math.sin(dLon/2)**2;

    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

}

const DISTANCE_MAX_RAISONNABLE_KM = 15;

// Simple debounce pour éviter de refiltrer à chaque frappe clavier
function debounce(fn, delai){

    let timer = null;

    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), delai);
    };

}

//==================================================
// Sauvegarde automatique locale (filet de sécurité)
//
// À chaque ajout/modification/suppression, l'état courant est enregistré
// dans le navigateur (localStorage). Si la page se ferme ou se recharge
// sans téléchargement, on peut ainsi proposer de restaurer le travail
// en cours au prochain chargement de la page. Ceci ne remplace PAS le
// téléchargement des fichiers JSON, qui reste la seule vraie sauvegarde.
//==================================================

function sauvegarderAutomatiquement(){

    try{

        localStorage.setItem(CLE_SAUVEGARDE, JSON.stringify({
            lieux,
            categories,
            date: new Date().toISOString()
        }));

    }catch(erreur){

        console.warn("Sauvegarde automatique locale impossible :", erreur);

    }

    mettreAJourIndicateurs();

}

function ilYADesChangementsNonTelecharges(){

    return (
        JSON.stringify(lieux) !== dernierLieuxTelecharges ||
        JSON.stringify(categories) !== dernieresCategoriesTelechargees
    );

}

function marquerLieuxCommeTelecharges(){
    dernierLieuxTelecharges = JSON.stringify(lieux);
    mettreAJourIndicateurs();
}

function marquerCategoriesCommeTelechargees(){
    dernieresCategoriesTelechargees = JSON.stringify(categories);
    mettreAJourIndicateurs();
}

function mettreAJourIndicateurs(){

    const etatLieux = document.getElementById("etatLieux");
    const etatCategories = document.getElementById("etatCategories");

    const lieuxAJour = JSON.stringify(lieux)===dernierLieuxTelecharges;
    const categoriesAJour = JSON.stringify(categories)===dernieresCategoriesTelechargees;

    etatLieux.textContent = lieuxAJour
        ? "✅ À jour avec le dernier téléchargement"
        : "⚠ Modifications non téléchargées !";
    etatLieux.className = "etatSauvegarde " + (lieuxAJour ? "aJour" : "enAttente");

    etatCategories.textContent = categoriesAJour
        ? "✅ À jour avec le dernier téléchargement"
        : "⚠ Modifications non téléchargées !";
    etatCategories.className = "etatSauvegarde " + (categoriesAJour ? "aJour" : "enAttente");

}

window.addEventListener("beforeunload", (e)=>{

    if(ilYADesChangementsNonTelecharges()){

        e.preventDefault();
        e.returnValue = ""; // nécessaire pour déclencher la boîte de dialogue

    }

});

//==================================================
// Chargement initial
//==================================================

async function chargerDonnees(){

    try{

        const [repLieux, repCategories] = await Promise.all([
            fetch("data/lieux.json"),
            fetch("data/categories.json")
        ]);

        if(!repLieux.ok || !repCategories.ok){
            throw new Error("Réponse HTTP invalide");
        }

        lieux = await repLieux.json();
        categories = await repCategories.json();

        marquerLieuxCommeTelecharges();
        marquerCategoriesCommeTelechargees();

        // Vérifie s'il existe une sauvegarde automatique locale plus
        // récente (issue d'une session précédente non téléchargée)
        try{

            const brut = localStorage.getItem(CLE_SAUVEGARDE);

            if(brut){

                const sauvegarde = JSON.parse(brut);

                const estDifferente =
                    JSON.stringify({lieux: sauvegarde.lieux, categories: sauvegarde.categories})
                    !== JSON.stringify({lieux, categories});

                if(estDifferente){

                    const date = new Date(sauvegarde.date).toLocaleString("fr-FR");

                    const veutRestaurer = confirm(
                        `Une sauvegarde automatique locale du ${date} a été ` +
                        `trouvée, avec ${sauvegarde.lieux.length} lieu(x) et ` +
                        `${sauvegarde.categories.length} catégorie(s), ` +
                        `différente des fichiers actuels sur le serveur.\n\n` +
                        `Cela vient probablement d'une session où tu avais ` +
                        `ajouté des éléments sans télécharger les fichiers.\n\n` +
                        `Veux-tu restaurer cette sauvegarde ?`
                    );

                    if(veutRestaurer){
                        lieux = sauvegarde.lieux;
                        categories = sauvegarde.categories;
                    }

                }

            }

        }catch(erreur){

            console.warn("Lecture de la sauvegarde automatique impossible :", erreur);

        }

    }catch(erreur){

        console.error(erreur);

        alert(
            "Impossible de charger les fichiers data/lieux.json et " +
            "data/categories.json.\n\n" +
            "Astuce : cette page doit être ouverte via un petit serveur " +
            "local (pas en double-cliquant sur le fichier). Voir l'onglet " +
            "'Comment ça marche' pour les commandes à utiliser."
        );

    }

    remplirSelectCategories();
    rafraichirListeLieux();
    rafraichirListeCategories();
    rafraichirListeEvenements();

}

//==================================================
// Onglets
//==================================================

document.querySelectorAll(".ongletBtn").forEach(btn=>{

    btn.addEventListener("click", ()=>{

        document.querySelectorAll(".ongletBtn").forEach(b=>b.classList.remove("actif"));
        document.querySelectorAll(".vue").forEach(v=>v.classList.remove("actif"));

        btn.classList.add("actif");
        document.getElementById(
            "vue" + btn.dataset.onglet.charAt(0).toUpperCase() + btn.dataset.onglet.slice(1)
        ).classList.add("actif");

        // Leaflet a besoin d'un recalcul de taille quand son conteneur
        // redevient visible (display:none -> grid)
        if(btn.dataset.onglet==="lieux" && miniCarte){
            setTimeout(()=>miniCarte.invalidateSize(), 50);
        }

        if(btn.dataset.onglet==="evenements" && miniCarteEvenement){
            setTimeout(()=>miniCarteEvenement.invalidateSize(), 50);
        }

    });

});

//==================================================
// Mini carte pour choisir les coordonnées
//==================================================

const miniCarte = L.map("miniCarte").setView(CENTRE_VILLE, 14);

L.tileLayer(
    "https://data.geopf.fr/wmts?LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&STYLE=normal&TILEMATRIXSET=PM&SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&FORMAT=image/png&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}",
    { attribution: "&copy; IGN", maxZoom: 19 }
).addTo(miniCarte);

let marqueurChoix = null;

miniCarte.on("click", (e)=>{

    document.getElementById("lieuLatitude").value = e.latlng.lat.toFixed(6);
    document.getElementById("lieuLongitude").value = e.latlng.lng.toFixed(6);

    if(marqueurChoix){
        marqueurChoix.setLatLng(e.latlng);
    }else{
        marqueurChoix = L.marker(e.latlng).addTo(miniCarte);
    }

});

//==================================================
// Mini carte pour choisir les coordonnées d'un événement
//==================================================

const miniCarteEvenement = L.map("miniCarteEvenement").setView(CENTRE_VILLE, 14);

L.tileLayer(
    "https://data.geopf.fr/wmts?LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&STYLE=normal&TILEMATRIXSET=PM&SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&FORMAT=image/png&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}",
    { attribution: "&copy; IGN", maxZoom: 19 }
).addTo(miniCarteEvenement);

let marqueurChoixEvenement = null;
let coordsEvenement = null;

miniCarteEvenement.on("click", (e)=>{

    coordsEvenement = { lat: e.latlng.lat, lng: e.latlng.lng };

    if(marqueurChoixEvenement){
        marqueurChoixEvenement.setLatLng(e.latlng);
    }else{
        marqueurChoixEvenement = L.marker(e.latlng).addTo(miniCarteEvenement);
    }

});

//==================================================
// Formulaire Lieux
//==================================================

const formLieu = document.getElementById("formLieu");
const btnAnnulerLieu = document.getElementById("btnAnnulerLieu");
const titreFormLieu = document.getElementById("titreFormLieu");
const conteneurHoraires = document.getElementById("horairesLieu");

//==================================================
// Horaires d'ouverture
//
// Format stocké dans lieux.json : un objet avec une clé par jour
// (lundi..dimanche), chacune contenant un tableau de créneaux au
// format "HH:MM-HH:MM". Un jour absent ou avec un tableau vide est
// considéré comme fermé / non renseigné.
//==================================================

function construireFormulaireHoraires(){

    conteneurHoraires.innerHTML = "";

    JOURS_SEMAINE.forEach(jour=>{

        const ligne = document.createElement("div");
        ligne.className = "ligneHoraire";
        ligne.dataset.jour = jour.cle;

        ligne.innerHTML = `
            <span class="nomJour">${jour.label}</span>
            <div class="creneauxJour">
                <div class="paireCreneau">
                    <span class="etiquetteCreneau">Matin</span>
                    <input type="time" class="creneau1Debut" aria-label="${jour.label} matin, début">
                    <input type="time" class="creneau1Fin" aria-label="${jour.label} matin, fin">
                </div>
                <div class="paireCreneau">
                    <span class="etiquetteCreneau">A.-midi</span>
                    <input type="time" class="creneau2Debut" aria-label="${jour.label} après-midi, début">
                    <input type="time" class="creneau2Fin" aria-label="${jour.label} après-midi, fin">
                </div>
            </div>
        `;

        conteneurHoraires.appendChild(ligne);

    });

}

// Lit l'état actuel du formulaire et construit l'objet horaires
function lireHorairesForm(){

    const horaires = {};

    JOURS_SEMAINE.forEach(jour=>{

        const ligne = conteneurHoraires.querySelector(`[data-jour="${jour.cle}"]`);

        const creneaux = [];

        const d1 = ligne.querySelector(".creneau1Debut").value;
        const f1 = ligne.querySelector(".creneau1Fin").value;
        const d2 = ligne.querySelector(".creneau2Debut").value;
        const f2 = ligne.querySelector(".creneau2Fin").value;

        if(d1 && f1) creneaux.push(`${d1}-${f1}`);
        if(d2 && f2) creneaux.push(`${d2}-${f2}`);

        horaires[jour.cle] = creneaux;

    });

    return horaires;

}

// Remplit le formulaire à partir d'un objet horaires existant (édition)
// ou le vide entièrement (nouveau lieu / annulation)
function remplirHorairesForm(horaires){

    JOURS_SEMAINE.forEach(jour=>{

        const ligne = conteneurHoraires.querySelector(`[data-jour="${jour.cle}"]`);
        const creneaux = (horaires && horaires[jour.cle]) || [];

        const [c1, c2] = creneaux;
        const [d1="", f1=""] = c1 ? c1.split("-") : [];
        const [d2="", f2=""] = c2 ? c2.split("-") : [];

        ligne.querySelector(".creneau1Debut").value = d1;
        ligne.querySelector(".creneau1Fin").value = f1;
        ligne.querySelector(".creneau2Debut").value = d2;
        ligne.querySelector(".creneau2Fin").value = f2;

    });

}

construireFormulaireHoraires();

document.getElementById("btnCopierLundi").addEventListener("click", ()=>{

    const ligneLundi = conteneurHoraires.querySelector('[data-jour="lundi"]');

    const valeurs = {
        d1: ligneLundi.querySelector(".creneau1Debut").value,
        f1: ligneLundi.querySelector(".creneau1Fin").value,
        d2: ligneLundi.querySelector(".creneau2Debut").value,
        f2: ligneLundi.querySelector(".creneau2Fin").value
    };

    conteneurHoraires.querySelectorAll(".ligneHoraire").forEach(ligne=>{

        if(ligne.dataset.jour==="lundi") return;

        ligne.querySelector(".creneau1Debut").value = valeurs.d1;
        ligne.querySelector(".creneau1Fin").value = valeurs.f1;
        ligne.querySelector(".creneau2Debut").value = valeurs.d2;
        ligne.querySelector(".creneau2Fin").value = valeurs.f2;

    });

});

//==================================================

function remplirSelectCategories(){

    const select = document.getElementById("lieuCategorie");
    const valeurActuelle = select.value;

    select.innerHTML = "";

    if(categories.length===0){
        select.add(new Option("Aucune catégorie — crée-en une d'abord", ""));
        return;
    }

    categories
        .slice()
        .sort((a,b)=>a.nom.localeCompare(b.nom,"fr"))
        .forEach(c=>{
            // Un <option> n'affiche que du texte : si l'icône est une image,
            // on utilise un pictogramme générique à la place.
            const prefixe = estImageIcone(c.icone) ? "🖼" : c.icone;
            select.add(new Option(`${prefixe} ${c.nom}`, c.nom));
        });

    if(valeurActuelle){
        select.value = valeurActuelle;
    }

    mettreAJourSelectSousCategorie();

}

// Remplit le menu "Sous-catégorie" selon la catégorie actuellement
// sélectionnée dans le formulaire ; le masque entièrement si cette
// catégorie n'a aucune sous-catégorie définie.
function mettreAJourSelectSousCategorie(valeurAConserver){

    const nomCategorie = document.getElementById("lieuCategorie").value;
    const cat = categories.find(c=>c.nom===nomCategorie);
    const sousCategories = cat?.sousCategories ?? [];

    const bloc = document.getElementById("blocSousCategorie");
    const select = document.getElementById("lieuSousCategorie");

    if(sousCategories.length===0){
        bloc.hidden = true;
        select.innerHTML = '<option value="">Aucune / non précisé</option>';
        return;
    }

    bloc.hidden = false;

    select.innerHTML = '<option value="">Aucune / non précisé</option>' +
        sousCategories
            .slice()
            .sort((a,b)=>a.localeCompare(b,"fr"))
            .map(sc => `<option value="${echapperHtml(sc)}">${echapperHtml(sc)}</option>`)
            .join("");

    if(valeurAConserver && sousCategories.includes(valeurAConserver)){
        select.value = valeurAConserver;
    }

}

document.getElementById("lieuCategorie").addEventListener("change", ()=>{
    mettreAJourSelectSousCategorie();
});

function viderFormLieu(){

    formLieu.reset();
    document.getElementById("lieuId").value = "";
    idLieuEnEdition = null;

    remplirHorairesForm(null);
    mettreAJourSelectSousCategorie();

    titreFormLieu.textContent = "Ajouter un lieu";
    formLieu.querySelector(".btnPrimaire").textContent = "Ajouter le lieu";
    btnAnnulerLieu.hidden = true;

    if(marqueurChoix){
        miniCarte.removeLayer(marqueurChoix);
        marqueurChoix = null;
    }

}

formLieu.addEventListener("submit", (e)=>{

    e.preventDefault();

    const lieu = {
        id: idLieuEnEdition ?? prochainId(),
        nom: document.getElementById("lieuNom").value.trim(),
        vedette: document.getElementById("lieuVedette").checked,
        categorie: document.getElementById("lieuCategorie").value,
        sousCategorie: document.getElementById("lieuSousCategorie").value,
        adresse: document.getElementById("lieuAdresse").value.trim(),
        telephone: document.getElementById("lieuTelephone").value.trim(),
        mail: document.getElementById("lieuMail").value.trim(),
        site: document.getElementById("lieuSite").value.trim(),
        description: document.getElementById("lieuDescription").value.trim(),
        photo: document.getElementById("lieuPhoto").value.trim(),
        dateFin: document.getElementById("lieuDateFin").value,
        horaires: lireHorairesForm(),
        latitude: parseFloat(document.getElementById("lieuLatitude").value),
        longitude: parseFloat(document.getElementById("lieuLongitude").value)
    };

    if(!lieu.categorie){
        alert("Choisis une catégorie (crée-en une dans l'onglet Catégories si besoin).");
        return;
    }

    if(Number.isNaN(lieu.latitude) || Number.isNaN(lieu.longitude)){
        alert("Renseigne des coordonnées valides (clique sur la mini-carte).");
        return;
    }

    // Alerte si un lieu au nom identique ou très proche existe déjà
    // (ex : faute de frappe, entrée en double lors d'une saisie en masse)
    const similaire = chercherLieuSimilaire(lieu.nom, idLieuEnEdition);

    if(similaire){

        const message = similaire.exact
            ? `Un lieu nommé exactement "${similaire.lieu.nom}" existe déjà.`
            : `Un lieu au nom très proche existe déjà : "${similaire.lieu.nom}".`;

        if(!confirm(`${message}\n\nEnregistrer quand même ce lieu ?`)){
            return;
        }

    }

    // Alerte si les coordonnées semblent très éloignées du centre-ville
    // (erreur fréquente : virgule/point mal placé, latitude/longitude inversées...)
    const distance = distanceKm(
        CENTRE_VILLE[0], CENTRE_VILLE[1],
        lieu.latitude, lieu.longitude
    );

    if(distance > DISTANCE_MAX_RAISONNABLE_KM){

        const veutContinuer = confirm(
            `Ce lieu se trouve à environ ${Math.round(distance)} km du ` +
            `centre-ville — vérifie que les coordonnées sont correctes ` +
            `(latitude/longitude non inversées, virgule bien placée...).\n\n` +
            `Enregistrer quand même ?`
        );

        if(!veutContinuer){
            return;
        }

    }

    if(idLieuEnEdition!==null){

        const index = lieux.findIndex(l=>l.id===idLieuEnEdition);
        lieux[index] = lieu;

    }else{

        lieux.push(lieu);

    }

    viderFormLieu();
    rafraichirListeLieux();
    sauvegarderAutomatiquement();

});

btnAnnulerLieu.addEventListener("click", viderFormLieu);

function modifierLieu(id){

    const lieu = lieux.find(l=>l.id===id);
    if(!lieu) return;

    idLieuEnEdition = id;

    document.getElementById("lieuId").value = lieu.id;
    document.getElementById("lieuNom").value = lieu.nom;
    document.getElementById("lieuVedette").checked = !!lieu.vedette;
    document.getElementById("lieuCategorie").value = lieu.categorie;
    mettreAJourSelectSousCategorie(lieu.sousCategorie);
    document.getElementById("lieuAdresse").value = lieu.adresse;
    document.getElementById("lieuTelephone").value = lieu.telephone ?? "";
    document.getElementById("lieuMail").value = lieu.mail ?? "";
    document.getElementById("lieuSite").value = lieu.site ?? "";
    document.getElementById("lieuDescription").value = lieu.description ?? "";
    document.getElementById("lieuPhoto").value = lieu.photo ?? "";
    document.getElementById("lieuDateFin").value = lieu.dateFin ?? "";
    document.getElementById("lieuLatitude").value = lieu.latitude;
    document.getElementById("lieuLongitude").value = lieu.longitude;

    remplirHorairesForm(lieu.horaires);

    const latlng = [lieu.latitude, lieu.longitude];

    if(marqueurChoix){
        marqueurChoix.setLatLng(latlng);
    }else{
        marqueurChoix = L.marker(latlng).addTo(miniCarte);
    }

    miniCarte.setView(latlng, 16);

    titreFormLieu.textContent = "Modifier le lieu";
    formLieu.querySelector(".btnPrimaire").textContent = "Enregistrer les modifications";
    btnAnnulerLieu.hidden = false;

    document.getElementById("vueLieux").scrollIntoView({behavior:"smooth"});

}

function supprimerLieu(id){

    const lieu = lieux.find(l=>l.id===id);
    if(!lieu) return;

    if(!confirm(`Supprimer "${lieu.nom}" ?`)) return;

    lieux = lieux.filter(l=>l.id!==id);

    if(idLieuEnEdition===id){
        viderFormLieu();
    }

    rafraichirListeLieux();
    sauvegarderAutomatiquement();

}

function rafraichirListeLieux(){

    const conteneur = document.getElementById("listeAdminLieux");

    // Les événements ont leur propre onglet, on ne les montre pas ici
    const lieuxSansEvenements = lieux.filter(l => !l.estEvenement);

    document.getElementById("compteurLieux").textContent = lieuxSansEvenements.length;

    if(lieuxSansEvenements.length===0){
        conteneur.innerHTML = `<p class="listeVide">Aucun lieu pour l'instant.</p>`;
        return;
    }

    const texteFiltre = document.getElementById("filtreListeLieux").value.trim().toLowerCase();

    const lieuxFiltres = lieuxSansEvenements.filter(lieu=>{

        if(texteFiltre===""){
            return true;
        }

        const champs = [lieu.nom, lieu.adresse, lieu.categorie, lieu.sousCategorie];

        return champs.some(champ => (champ ?? "").toLowerCase().includes(texteFiltre));

    });

    conteneur.innerHTML = "";

    if(lieuxFiltres.length===0){
        conteneur.innerHTML = `<p class="listeVide">Aucun lieu ne correspond à ce filtre.</p>`;
        return;
    }

    const triChoisi = document.getElementById("triListeLieux").value;

    lieuxFiltres
        .slice()
        .sort((a,b)=>{

            if(triChoisi==="categorie"){

                const comparaisonCategorie = a.categorie.localeCompare(b.categorie,"fr");

                if(comparaisonCategorie!==0) return comparaisonCategorie;

            }

            return a.nom.localeCompare(b.nom,"fr");

        })
        .forEach(lieu=>{

            const cat = categories.find(c=>c.nom===lieu.categorie);
            const couleur = cat ? cat.couleur : "#999";
            const icone = cat ? cat.icone : "📍";

            const div = document.createElement("div");
            div.className = "ligneAdmin";

            div.innerHTML = `
                <div class="infos">
                    <div class="nom">${rendreIcone(icone)} ${echapperHtml(lieu.nom)}</div>
                    <div class="details">
                        <span class="pastille" style="background:${couleur}"></span>
                        ${echapperHtml(lieu.categorie)}${lieu.sousCategorie ? ` › ${echapperHtml(lieu.sousCategorie)}` : ""} — ${echapperHtml(lieu.adresse)}
                    </div>
                </div>
                <div class="actions">
                    <button type="button" class="modifier">✏ Modifier</button>
                    <button type="button" class="supprimer">🗑 Supprimer</button>
                </div>
            `;

            div.querySelector(".modifier").addEventListener("click", ()=>modifierLieu(lieu.id));
            div.querySelector(".supprimer").addEventListener("click", ()=>supprimerLieu(lieu.id));

            conteneur.appendChild(div);

        });

}

document.getElementById("btnTelechargerLieux").addEventListener("click", ()=>{
    telechargerJson("lieux.json", lieux);
    marquerLieuxCommeTelecharges();
});

//==================================================
// Formulaire Événements
//
// Les événements sont enregistrés dans le même tableau `lieux` (donc le
// même fichier lieux.json), avec un marqueur estEvenement:true qui les
// distingue des lieux permanents. Cela permet de réutiliser telle quelle
// toute la logique déjà en place côté site principal (affichage sur la
// carte, disparition automatique après la date de fin, etc.).
//==================================================

const formEvenement = document.getElementById("formEvenement");
const btnAnnulerEvenement = document.getElementById("btnAnnulerEvenement");
const titreFormEvenement = document.getElementById("titreFormEvenement");

let idEvenementEnEdition = null;

function viderFormEvenement(){

    formEvenement.reset();
    document.getElementById("evenementId").value = "";
    idEvenementEnEdition = null;

    if(marqueurChoixEvenement){
        miniCarteEvenement.removeLayer(marqueurChoixEvenement);
        marqueurChoixEvenement = null;
    }
    coordsEvenement = null;

    titreFormEvenement.textContent = "Ajouter un événement";
    formEvenement.querySelector(".btnPrimaire").textContent = "Ajouter l'événement";
    btnAnnulerEvenement.hidden = true;

}

formEvenement.addEventListener("submit", (e)=>{

    e.preventDefault();

    const dateDebut = document.getElementById("evenementDateDebut").value;
    const dateFin = document.getElementById("evenementDateFin").value;

    if(dateFin < dateDebut){
        alert("La date de fin ne peut pas être antérieure à la date de début.");
        return;
    }

    const coords = coordsEvenement ?? { lat: CENTRE_VILLE[0], lng: CENTRE_VILLE[1] };

    if(!coordsEvenement){
        const confirmerSansPosition = confirm(
            "Tu n'as pas cliqué sur la mini-carte pour placer précisément " +
            "l'événement : il sera positionné au centre-ville par défaut.\n\n" +
            "Continuer quand même ?"
        );
        if(!confirmerSansPosition) return;
    }

    const evenement = {
        id: idEvenementEnEdition ?? prochainId(),
        estEvenement: true,
        nom: document.getElementById("evenementNom").value.trim(),
        categorie: "Événement",
        sousCategorie: "",
        vedette: document.getElementById("evenementVedette").checked,
        adresse: document.getElementById("evenementLocalisation").value.trim(),
        description: document.getElementById("evenementDescription").value.trim(),
        horairesEvenement: document.getElementById("evenementHoraires").value.trim(),
        dateDebut,
        dateFin,
        telephone: "",
        mail: "",
        site: "",
        photo: "",
        horaires: {},
        latitude: coords.lat,
        longitude: coords.lng
    };

    if(idEvenementEnEdition!==null){

        const index = lieux.findIndex(l=>l.id===idEvenementEnEdition);
        lieux[index] = evenement;

    }else{

        lieux.push(evenement);

    }

    viderFormEvenement();
    rafraichirListeEvenements();
    sauvegarderAutomatiquement();

});

btnAnnulerEvenement.addEventListener("click", viderFormEvenement);

function modifierEvenement(id){

    const evenement = lieux.find(l=>l.id===id);
    if(!evenement) return;

    idEvenementEnEdition = id;

    document.getElementById("evenementId").value = evenement.id;
    document.getElementById("evenementNom").value = evenement.nom;
    document.getElementById("evenementVedette").checked = !!evenement.vedette;
    document.getElementById("evenementDescription").value = evenement.description ?? "";
    document.getElementById("evenementLocalisation").value = evenement.adresse;
    document.getElementById("evenementHoraires").value = evenement.horairesEvenement ?? "";
    document.getElementById("evenementDateDebut").value = evenement.dateDebut;
    document.getElementById("evenementDateFin").value = evenement.dateFin;

    coordsEvenement = { lat: evenement.latitude, lng: evenement.longitude };

    const latlng = [evenement.latitude, evenement.longitude];

    if(marqueurChoixEvenement){
        marqueurChoixEvenement.setLatLng(latlng);
    }else{
        marqueurChoixEvenement = L.marker(latlng).addTo(miniCarteEvenement);
    }

    miniCarteEvenement.setView(latlng, 16);

    titreFormEvenement.textContent = "Modifier l'événement";
    formEvenement.querySelector(".btnPrimaire").textContent = "Enregistrer les modifications";
    btnAnnulerEvenement.hidden = false;

    document.getElementById("vueEvenements").scrollIntoView({behavior:"smooth"});

}

function supprimerEvenement(id){

    const evenement = lieux.find(l=>l.id===id);
    if(!evenement) return;

    if(!confirm(`Supprimer l'événement "${evenement.nom}" ?`)) return;

    lieux = lieux.filter(l=>l.id!==id);

    if(idEvenementEnEdition===id){
        viderFormEvenement();
    }

    rafraichirListeEvenements();
    sauvegarderAutomatiquement();

}

function rafraichirListeEvenements(){

    const conteneur = document.getElementById("listeAdminEvenements");
    const evenements = lieux.filter(l => l.estEvenement);

    document.getElementById("compteurEvenements").textContent = evenements.length;

    if(evenements.length===0){
        conteneur.innerHTML = `<p class="listeVide">Aucun événement pour l'instant.</p>`;
        return;
    }

    const aujourdhui = new Date().toISOString().slice(0,10);

    conteneur.innerHTML = "";

    evenements
        .slice()
        .sort((a,b)=> a.dateDebut.localeCompare(b.dateDebut))
        .forEach(evenement=>{

            let statut, couleurStatut;

            if(evenement.dateFin < aujourdhui){
                statut = "Expiré";
                couleurStatut = "#999";
            }else if(evenement.dateDebut > aujourdhui){
                statut = "À venir";
                couleurStatut = "#1976d2";
            }else{
                statut = "En cours";
                couleurStatut = "#1e7e34";
            }

            const periode = evenement.dateDebut===evenement.dateFin
                ? formaterDateFr(evenement.dateDebut)
                : `${formaterDateFr(evenement.dateDebut)} → ${formaterDateFr(evenement.dateFin)}`;

            const div = document.createElement("div");
            div.className = "ligneAdmin";

            div.innerHTML = `
                <div class="infos">
                    <div class="nom">🎉 ${echapperHtml(evenement.nom)}</div>
                    <div class="details">
                        <span class="pastille" style="background:${couleurStatut}"></span>
                        ${statut} — ${periode} — ${echapperHtml(evenement.adresse)}
                    </div>
                </div>
                <div class="actions">
                    <button type="button" class="modifier">✏ Modifier</button>
                    <button type="button" class="supprimer">🗑 Supprimer</button>
                </div>
            `;

            div.querySelector(".modifier").addEventListener("click", ()=>modifierEvenement(evenement.id));
            div.querySelector(".supprimer").addEventListener("click", ()=>supprimerEvenement(evenement.id));

            conteneur.appendChild(div);

        });

}

function formaterDateFr(dateIso){
    const [a,m,j] = dateIso.split("-");
    return `${j}/${m}/${a}`;
}

document.getElementById("btnTelechargerEvenements").addEventListener("click", ()=>{
    telechargerJson("lieux.json", lieux);
    marquerLieuxCommeTelecharges();
});

//==================================================
// Formulaire Catégories
//==================================================

const formCategorie = document.getElementById("formCategorie");
const btnAnnulerCategorie = document.getElementById("btnAnnulerCategorie");
const titreFormCategorie = document.getElementById("titreFormCategorie");
const blocIconeEmoji = document.getElementById("blocIconeEmoji");
const blocIconeImage = document.getElementById("blocIconeImage");
const champCategorieIcone = document.getElementById("categorieIcone");
const champCategorieImageFichier = document.getElementById("categorieImageFichier");
const apercuIcone = document.getElementById("apercuIcone");
const apercuIconeImg = document.getElementById("apercuIconeImg");
const apercuIconeTaille = document.getElementById("apercuIconeTaille");

const TAILLE_MAX_ICONE = 64; // px, largeur/hauteur max de l'icône stockée

// Contient le data-URL base64 de l'image choisie (ou déjà enregistrée en édition)
let iconeImageActuelle = null;

//==================================================
// Sous-catégories (étiquettes) du formulaire Catégorie
//==================================================

let sousCategoriesEnCours = [];

function rafraichirListeTagsSousCategories(){

    const conteneur = document.getElementById("listeSousCategories");

    if(sousCategoriesEnCours.length===0){
        conteneur.innerHTML = `<p class="listeVide" style="padding:6px 0;">Aucune sous-catégorie ajoutée.</p>`;
        return;
    }

    conteneur.innerHTML = sousCategoriesEnCours.map((sc, index) => `
        <span class="tag">
            ${echapperHtml(sc)}
            <button type="button" data-index="${index}" aria-label="Retirer ${echapperHtml(sc)}">✕</button>
        </span>
    `).join("");

    conteneur.querySelectorAll("button").forEach(btn=>{
        btn.addEventListener("click", ()=>{
            sousCategoriesEnCours.splice(Number(btn.dataset.index), 1);
            rafraichirListeTagsSousCategories();
        });
    });

}

function ajouterSousCategorieDepuisChamp(){

    const champ = document.getElementById("sousCategorieSaisie");
    const valeur = champ.value.trim();

    if(!valeur) return;

    const existeDeja = sousCategoriesEnCours.some(
        sc => sc.toLowerCase()===valeur.toLowerCase()
    );

    if(existeDeja){
        alert("Cette sous-catégorie a déjà été ajoutée.");
        return;
    }

    sousCategoriesEnCours.push(valeur);
    champ.value = "";
    champ.focus();

    rafraichirListeTagsSousCategories();

}

document.getElementById("btnAjouterSousCategorie").addEventListener("click", ajouterSousCategorieDepuisChamp);

document.getElementById("sousCategorieSaisie").addEventListener("keydown", (e)=>{

    // Ajoute avec Entrée, sans soumettre tout le formulaire catégorie
    if(e.key==="Enter"){
        e.preventDefault();
        ajouterSousCategorieDepuisChamp();
    }

});

rafraichirListeTagsSousCategories();

// Une valeur d'icône est considérée comme une image si c'est un data-URL
function estImageIcone(valeur){
    return typeof valeur==="string" && valeur.startsWith("data:image");
}

// Redimensionne un fichier image en un petit PNG carré (transparent),
// et renvoie une Promise du data-URL résultant, pour garder
// categories.json léger même avec des images uploadées.
function redimensionnerImage(fichier){

    return new Promise((resoudre, rejeter)=>{

        const lecteur = new FileReader();

        lecteur.onerror = ()=>rejeter(new Error("Lecture du fichier impossible"));

        lecteur.onload = ()=>{

            const img = new Image();

            img.onerror = ()=>rejeter(new Error("Image invalide ou illisible"));

            img.onload = ()=>{

                const canvas = document.createElement("canvas");
                canvas.width = TAILLE_MAX_ICONE;
                canvas.height = TAILLE_MAX_ICONE;

                const ctx = canvas.getContext("2d");

                const largeurSource = img.naturalWidth || TAILLE_MAX_ICONE;
                const hauteurSource = img.naturalHeight || TAILLE_MAX_ICONE;

                // Redimensionnement "contain" : l'image tient entière
                // dans le carré, centrée, sans être déformée.
                const ratio = Math.min(
                    TAILLE_MAX_ICONE/largeurSource,
                    TAILLE_MAX_ICONE/hauteurSource
                );

                const largeurDest = largeurSource*ratio;
                const hauteurDest = hauteurSource*ratio;
                const x = (TAILLE_MAX_ICONE-largeurDest)/2;
                const y = (TAILLE_MAX_ICONE-hauteurDest)/2;

                ctx.drawImage(img, x, y, largeurDest, hauteurDest);

                resoudre(canvas.toDataURL("image/png"));

            };

            img.src = lecteur.result;

        };

        lecteur.readAsDataURL(fichier);

    });

}

function afficherApercuIcone(dataUrl){

    apercuIcone.hidden = false;
    apercuIconeImg.src = dataUrl;

    const kiloOctets = Math.round((dataUrl.length*0.75)/1024);
    apercuIconeTaille.textContent = `(≈ ${kiloOctets} Ko)`;

}

function masquerApercuIcone(){
    apercuIcone.hidden = true;
    apercuIconeImg.src = "";
}

// Bascule entre les blocs "emoji" et "image" selon le radio sélectionné
document.querySelectorAll('input[name="typeIcone"]').forEach(radio=>{

    radio.addEventListener("change", ()=>{

        const estImage = document.querySelector('input[name="typeIcone"]:checked').value==="image";

        blocIconeEmoji.hidden = estImage;
        blocIconeImage.hidden = !estImage;

        if(estImage){

            champCategorieIcone.value = "";

            if(iconeImageActuelle){
                afficherApercuIcone(iconeImageActuelle);
            }else{
                masquerApercuIcone();
            }

        }else{

            iconeImageActuelle = null;
            champCategorieImageFichier.value = "";
            masquerApercuIcone();

        }

    });

});

champCategorieImageFichier.addEventListener("change", async ()=>{

    const fichier = champCategorieImageFichier.files[0];
    if(!fichier) return;

    try{

        iconeImageActuelle = await redimensionnerImage(fichier);
        afficherApercuIcone(iconeImageActuelle);

    }catch(erreur){

        console.error(erreur);
        alert("Impossible de traiter cette image : " + erreur.message);
        iconeImageActuelle = null;
        masquerApercuIcone();

    }

});

function viderFormCategorie(){

    formCategorie.reset();
    document.getElementById("categorieAncienNom").value = "";
    document.getElementById("categorieCouleur").value = "#2c7be5";
    nomCategorieEnEdition = null;
    iconeImageActuelle = null;

    document.querySelector('input[name="typeIcone"][value="emoji"]').checked = true;
    blocIconeEmoji.hidden = false;
    blocIconeImage.hidden = true;
    masquerApercuIcone();

    sousCategoriesEnCours = [];
    rafraichirListeTagsSousCategories();

    titreFormCategorie.textContent = "Ajouter une catégorie";
    formCategorie.querySelector(".btnPrimaire").textContent = "Ajouter la catégorie";
    btnAnnulerCategorie.hidden = true;

}

formCategorie.addEventListener("submit", (e)=>{

    e.preventDefault();

    const nom = document.getElementById("categorieNom").value.trim();
    const typeIcone = document.querySelector('input[name="typeIcone"]:checked').value;
    const couleur = document.getElementById("categorieCouleur").value;

    let icone;

    if(typeIcone==="image"){

        if(!iconeImageActuelle){
            alert("Choisis un fichier image pour cette catégorie.");
            return;
        }

        icone = iconeImageActuelle;

    }else{

        icone = champCategorieIcone.value.trim();

        if(!icone){
            alert("Renseigne un emoji pour cette catégorie.");
            return;
        }

    }

    const doublon = categories.find(c=>
        c.nom.toLowerCase()===nom.toLowerCase() && c.nom!==nomCategorieEnEdition
    );

    if(doublon){
        alert("Cette catégorie existe déjà.");
        return;
    }

    if(nomCategorieEnEdition!==null){

        const ancienNom = nomCategorieEnEdition;
        const index = categories.findIndex(c=>c.nom===ancienNom);
        categories[index] = { nom, icone, couleur, sousCategories: sousCategoriesEnCours };

        // Si le nom a changé, on met à jour les lieux qui l'utilisaient
        if(ancienNom!==nom){
            lieux.forEach(l=>{
                if(l.categorie===ancienNom) l.categorie = nom;
            });
        }

    }else{

        categories.push({ nom, icone, couleur, sousCategories: sousCategoriesEnCours });

    }

    viderFormCategorie();
    remplirSelectCategories();
    rafraichirListeCategories();
    rafraichirListeLieux();
    sauvegarderAutomatiquement();

});

btnAnnulerCategorie.addEventListener("click", viderFormCategorie);

function modifierCategorie(nom){

    const cat = categories.find(c=>c.nom===nom);
    if(!cat) return;

    nomCategorieEnEdition = nom;

    document.getElementById("categorieAncienNom").value = nom;
    document.getElementById("categorieNom").value = cat.nom;
    document.getElementById("categorieCouleur").value = cat.couleur;

    if(estImageIcone(cat.icone)){

        document.querySelector('input[name="typeIcone"][value="image"]').checked = true;
        blocIconeEmoji.hidden = true;
        blocIconeImage.hidden = false;

        iconeImageActuelle = cat.icone;
        afficherApercuIcone(cat.icone);

        champCategorieIcone.value = "";

    }else{

        document.querySelector('input[name="typeIcone"][value="emoji"]').checked = true;
        blocIconeEmoji.hidden = false;
        blocIconeImage.hidden = true;

        champCategorieIcone.value = cat.icone;
        iconeImageActuelle = null;
        masquerApercuIcone();

    }

    sousCategoriesEnCours = [...(cat.sousCategories ?? [])];
    rafraichirListeTagsSousCategories();

    titreFormCategorie.textContent = "Modifier la catégorie";
    formCategorie.querySelector(".btnPrimaire").textContent = "Enregistrer les modifications";
    btnAnnulerCategorie.hidden = false;

    document.getElementById("vueCategories").scrollIntoView({behavior:"smooth"});

}

function supprimerCategorie(nom){

    const utilisePar = lieux.filter(l=>l.categorie===nom).length;

    if(utilisePar>0){
        alert(
            `Impossible de supprimer "${nom}" : ${utilisePar} lieu(x) ` +
            `l'utilisent encore. Change leur catégorie avant de supprimer.`
        );
        return;
    }

    if(!confirm(`Supprimer la catégorie "${nom}" ?`)) return;

    categories = categories.filter(c=>c.nom!==nom);

    if(nomCategorieEnEdition===nom){
        viderFormCategorie();
    }

    remplirSelectCategories();
    rafraichirListeCategories();
    sauvegarderAutomatiquement();

}

function rafraichirListeCategories(){

    const conteneur = document.getElementById("listeAdminCategories");
    document.getElementById("compteurCategories").textContent = categories.length;

    if(categories.length===0){
        conteneur.innerHTML = `<p class="listeVide">Aucune catégorie pour l'instant.</p>`;
        return;
    }

    conteneur.innerHTML = "";

    categories
        .slice()
        .sort((a,b)=>a.nom.localeCompare(b.nom,"fr"))
        .forEach(cat=>{

            const nbLieux = lieux.filter(l=>l.categorie===cat.nom).length;

            const div = document.createElement("div");
            div.className = "ligneAdmin";

            div.innerHTML = `
                <div class="infos">
                    <div class="nom">${rendreIcone(cat.icone)} ${echapperHtml(cat.nom)}</div>
                    <div class="details">
                        <span class="pastille" style="background:${cat.couleur}"></span>
                        ${cat.couleur} — utilisée par ${nbLieux} lieu(x)
                    </div>
                </div>
                <div class="actions">
                    <button type="button" class="modifier">✏ Modifier</button>
                    <button type="button" class="supprimer">🗑 Supprimer</button>
                </div>
            `;

            div.querySelector(".modifier").addEventListener("click", ()=>modifierCategorie(cat.nom));
            div.querySelector(".supprimer").addEventListener("click", ()=>supprimerCategorie(cat.nom));

            conteneur.appendChild(div);

        });

}

document.getElementById("btnTelechargerCategories").addEventListener("click", ()=>{
    telechargerJson("categories.json", categories);
    marquerCategoriesCommeTelechargees();
});

document.getElementById("filtreListeLieux").addEventListener("input", debounce(rafraichirListeLieux, 150));
document.getElementById("triListeLieux").addEventListener("change", rafraichirListeLieux);

//==================================================
// Démarrage
//==================================================

chargerDonnees();
