/******************************************************************************
 * Templeuve Interactive
 * Version 0.4
 ******************************************************************************/

const CENTRE_VILLE = [50.5230, 3.1710];
const ZOOM_DEPART = 15;

//==================================================
// Création de la carte
//==================================================

const carte = L.map("map").setView(CENTRE_VILLE, ZOOM_DEPART);

L.tileLayer(
    "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    {
        attribution: "&copy; OpenStreetMap contributors",
        maxZoom: 20
    }
).addTo(carte);

//==================================================
// Eléments HTML
//==================================================

const txtRecherche = document.getElementById("search");
const cboCategorie = document.getElementById("categorie");
const liste = document.getElementById("listeLieux");
const compteur = document.getElementById("compteur");
const ficheLieu = document.getElementById("ficheLieu");
function afficherFiche(lieu){

    ficheLieu.innerHTML = `

        <div class="fiche">

            <div class="ficheTitre">

                ${icone(lieu.categorie)} ${lieu.nom}

            </div>

            <div class="ficheCategorie">

                ${lieu.categorie}

            </div>

            <hr>

            <div class="ficheLigne">

                📍 ${lieu.adresse}

            </div>

            ${
                lieu.telephone
                ?
                `<div class="ficheLigne">☎ ${lieu.telephone}</div>`
                :
                ""
            }

            ${
                lieu.mail
                ?
                `<div class="ficheLigne">✉ ${lieu.mail}</div>`
                :
                ""
            }

            ${
                lieu.site
                ?
                `<div class="ficheLigne">

                    🌍
                    <a href="${lieu.site}" target="_blank">
                        ${lieu.site}
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

                    ${lieu.description}

                </div>
                `
                :
                ""
            }

        </div>

    `;

}

//==================================================

let lieux = [];
let groupe = L.featureGroup().addTo(carte);
let elementSelectionne = null;

//==================================================

chargerLieux();

//==================================================

async function chargerLieux(){

    const rep = await fetch("data/lieux.json");

    lieux = await rep.json();

    lieux.sort((a,b)=>a.nom.localeCompare(b.nom));

    creerCategories();

    afficher();

}

//==================================================

function creerCategories(){

    cboCategorie.innerHTML="";

    cboCategorie.add(new Option("Toutes les catégories","Toutes"));

    [...new Set(lieux.map(l=>l.categorie))]
        .sort()
        .forEach(c=>{

            cboCategorie.add(new Option(c,c));

        });

}

//==================================================

function afficher(){

    groupe.clearLayers();

    liste.innerHTML="";

    const texte = txtRecherche.value.toLowerCase();

    const categorie = cboCategorie.value;

    const resultat = lieux.filter(l=>{

        const okNom =
            l.nom.toLowerCase().includes(texte);

        const okAdresse =
            l.adresse.toLowerCase().includes(texte);

        const okDescription =
            l.description.toLowerCase().includes(texte);

        const okCategorie =
            categorie==="Toutes" ||
            l.categorie===categorie;

        return okNom && okCategorie ||
               okAdresse && okCategorie ||
               okDescription && okCategorie;

    });

    compteur.textContent=resultat.length+" lieu(x)";

    resultat.forEach(lieu=>{

        const marker = L.marker(
    [
        lieu.latitude,
        lieu.longitude
    ],
    {
        icon: creerIcone(lieu)
    }
).addTo(groupe);

        marker.bindPopup(creerPopup(lieu));

        ajouterDansListe(lieu,marker);

    });

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

    let html="<b>"+icone(lieu.categorie)+" "+lieu.nom+"</b>";

    html+="<br><br>";

    html+="📍 "+lieu.adresse;

    if(lieu.telephone!="")
        html+="<br>☎ "+lieu.telephone;

    if(lieu.site!="")
        html+="<br><a href='"+lieu.site+"' target='_blank'>🌍 Site internet</a>";

    if(lieu.description!="")
        html+="<br><br>"+lieu.description;

    return html;

}

//==================================================

function ajouterDansListe(lieu,marker){

    const div=document.createElement("div");

    div.className="lieu";

    div.innerHTML=
    `
        <div class="nomLieu">

            ${icone(lieu.categorie)} ${lieu.nom}

        </div>

        <div class="categorieLieu">

            ${lieu.categorie}

        </div>
    `;

    div.onclick=()=>{

        if(elementSelectionne){

            elementSelectionne.style.background="white";

        }

        div.style.background="#d9ebff";

        elementSelectionne=div;

        carte.setView(
            [
                lieu.latitude,
                lieu.longitude
            ],
            17
        );

        marker.openPopup();afficherFiche(lieu);

    };

    liste.appendChild(div);

}

//==================================================

function icone(cat){

    switch(cat){

        case "Administration": return "🏛";
        case "Patrimoine": return "⛪";
        case "Transport": return "🚉";
        case "Sport": return "⚽";
        case "Santé": return "💊";
        case "Restaurant": return "🍽";
        case "Commerce": return "🛒";

        default:
            return "📍";

    }function couleurCategorie(categorie){

    switch(categorie){

        case "Administration":
            return "#1976d2";

        case "Patrimoine":
            return "#8e24aa";

        case "Transport":
            return "#d32f2f";

        case "Sport":
            return "#2e7d32";

        case "Santé":
            return "#e91e63";

        case "Restaurant":
            return "#ef6c00";

        case "Commerce":
            return "#f9a825";

        default:
            return "#555555";

    }

}

function creerIcone(lieu){

    return L.divIcon({

        className: "",

        html: `
            <div
                style="
                    width:22px;
                    height:22px;
                    border-radius:50%;
                    background:${couleurCategorie(lieu.categorie)};
                    border:3px solid white;
                    box-shadow:0 0 6px rgba(0,0,0,.35);
                ">
            </div>
        `,

        iconSize:[22,22],
        iconAnchor:[11,11],
        popupAnchor:[0,-10]

    });

}

}

//==================================================

txtRecherche.oninput=afficher;

cboCategorie.onchange=afficher;