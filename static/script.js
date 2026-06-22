// --- 🛰️ GEOLOCATION & USER COORDINATES PIPELINE ---
function getUserLocation() {
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(sendLocationToServer, handleError);
    } else {
        console.log("Geolocation is not supported by this browser.");
    }
}

function sendLocationToServer(position) {
    const lat = position.coords.latitude;
    const lon = position.coords.longitude;
    const alt = position.coords.altitude || 0;
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

    const serverLatVal = parseFloat(document.body.getAttribute('data-current-lat'));
    const serverLonVal = parseFloat(document.body.getAttribute('data-current-lon'));

    if (serverLatVal && serverLonVal && 
        Math.abs(lat - serverLatVal) < 0.01 && 
        Math.abs(lon - serverLonVal) < 0.01) {
        console.log("Location unchanged. Skipping reload loop.");
        return;
    }

    console.log(`New Location Detected! Updating: Lat ${lat}, Lon ${lon}`);

    fetch('/set-location', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ latitude: lat, longitude: lon, elevation: alt, timezone: tz })
    })
    .then(response => response.json())
    .then(data => {
        if (data.status === 'success') {
            window.location.reload();
        }
    });
}

function handleError(error) {
    console.warn(`Location access denied or unavailable: ${error.message}`);
}


// --- 🌎 3D GLOBE ENGINE STATE ---
let myGlobe;
let orbitPoints = [];
let currentPathIndex = 0;
let animationProgress = 0.0;
const animationSpeed = 0.002;

let userLat = null;
let userLng = null;


// --- 📐 ORBIT DATA INTERPOLATOR ROUTINES ---
async function fetchActiveOrbitPath() {
    const selectBox = document.getElementById('satellite-select');
    if (!selectBox || !myGlobe) return;

    const activeSatName = selectBox.value;
    const safeUrlName = encodeURIComponent(activeSatName);
    console.log(`📡 Fetching orbit path data from API for: ${activeSatName}...`);

    try {
        const response = await fetch(`/api/orbit/${safeUrlName}`);
        orbitPoints = await response.json();

        console.log("API RESPONSE - Received Orbit Points Array:", orbitPoints);

        if (Array.isArray(orbitPoints) && orbitPoints.length > 0) {
            myGlobe.pathsData([{ coords: orbitPoints }]);
            console.log(`✅ Successfully mapped ${orbitPoints.length} path track coordinates.`);
            currentPathIndex = 0;
            animationProgress = 0.0;
        } else {
            console.warn("API warning: Orbit points array came back completely empty.");
        }
    } catch (error) {
        console.error("API Error: Failed to sync orbit coordinate points:", error);
    }
}


// --- 🔴 SATELLITE + USER DOT ANIMATION LOOP ---
function animateSatelliteNode() {
    if (!myGlobe) {
        requestAnimationFrame(animateSatelliteNode);
        return;
    }

    const activeTrackingNodes = [];

    // 1. SATELLITE POSITION
    if (orbitPoints && orbitPoints.length >= 2) {
        const startPoint = orbitPoints[currentPathIndex];
        const endPoint = orbitPoints[currentPathIndex + 1];

        if (endPoint) {
            const startLat = startPoint.lat;
            const startLng = startPoint.lng !== undefined ? startPoint.lng : startPoint.lon;
            const endLat = endPoint.lat;
            const endLng = endPoint.lng !== undefined ? endPoint.lng : endPoint.lon;
            const startAlt = startPoint.alt || 0.06;
            const endAlt = endPoint.alt || 0.06;

            const interpolatedLat = startLat + (endLat - startLat) * animationProgress;
            const interpolatedLng = startLng + (endLng - startLng) * animationProgress;
            const interpolatedAlt = startAlt + (endAlt - startAlt) * animationProgress;

            if (currentPathIndex === 0 && animationProgress < 0.01) {
                console.log("SAT ALT debug:", interpolatedAlt, "| startPoint.alt:", startPoint.alt);
            }

            activeTrackingNodes.push({
                lat: interpolatedLat,
                lng: interpolatedLng,
                alt: interpolatedAlt,
                isSatellite: true
            });

            animationProgress += animationSpeed;

            if (animationProgress >= 1.0) {
                animationProgress = 0.0;
                currentPathIndex++;
            }
        } else {
            currentPathIndex = 0;
            animationProgress = 0.0;
        }
    }

    // 2. USER GROUND STATION DOT
    if (userLat !== null && !isNaN(userLat) && userLng !== null && !isNaN(userLng)) {
        activeTrackingNodes.push({
            lat: userLat,
            lng: userLng,
            alt: 0.005,
            isSatellite: false
        });
    }

    // 3. PUSH TO GLOBE
    myGlobe.customLayerData(activeTrackingNodes);

    requestAnimationFrame(animateSatelliteNode);
}


// --- ⏱️ COUNTDOWN & LIVE PASS TELEMETRY ---
let liveTrackingInterval = null;

function update_countdown() {
    const el = document.getElementById('countdown');
    if (!el) return;

    const target = parseInt(el.getAttribute('date-time'), 10);
    const now = new Date().getTime();
    const diff = target - now;

    if (diff <= 0) {
        if (!liveTrackingInterval) {
            const urlParams = new URLSearchParams(window.location.search);
            const activeSatellite = urlParams.get('satellite') || 'ISS (ZARYA)';
            startLiveTracking(activeSatellite, el);
        }
        return;
    }

    const hrs = Math.floor(diff / 3600000);
    const mins = Math.floor((diff % 3600000) / 60000);
    const secs = Math.floor((diff % 60000) / 1000);

    el.innerHTML = `${hrs.toString().padStart(2, '0')}h ${mins.toString().padStart(2, '0')}m ${secs.toString().padStart(2, '0')}s`;
}

function startLiveTracking(satelliteName, displayElement) {
    console.log(`Starting live tracking for: ${satelliteName}`);
    displayElement.style.color = "#FF3B30";

    function fetchTelemetry() {
        fetch(`/get-live-position?satellite=${encodeURIComponent(satelliteName)}`)
        .then(response => response.json())
        .then(function(data) {
            if (data.error) {
                displayElement.innerHTML = "LIVE TELEMETRY UNAVAILABLE";
                return;
            }

            if (data.above_horizon) {
                displayElement.innerHTML = `
                    <div class="live-pulse-container">
                        <span class="pulse-icon">🔴</span> LIVE OVERHEAD PASS
                    </div>
                    <div style="font-size: 1.5rem; margin-top: 10px; font-family: monospace;">
                        ALT: <span style="color:#4CD964;">${data.alt}°</span> | 
                        AZ: <span style="color:#5AC8FA;">${data.az}° (${data.dir})</span>
                    </div>
                `;
            } else {
                displayElement.innerHTML = "PASS COMPLETED. ADJUSTING LOGS...";
                clearInterval(liveTrackingInterval);
                setTimeout(() => { window.location.reload(); }, 3000);
            }
        });
    }

    fetchTelemetry();
    liveTrackingInterval = setInterval(fetchTelemetry, 2000);
}

function switchSatellite(satelliteName) {
    window.location.href = `/?satellite=${encodeURIComponent(satelliteName)}`;
}


// --- ⚙️ LIFECYCLE INITIALIZERS ---
window.onload = function() {
    getUserLocation();
    update_countdown();
    setInterval(update_countdown, 1000);
};

document.addEventListener("DOMContentLoaded", () => {
    const THREE = window.__THREE__;
    const globeElement = document.getElementById('globe-container');

    const rawLat = document.body.getAttribute('data-current-lat');
    const rawLon = document.body.getAttribute('data-current-lon');
    userLat = parseFloat(rawLat);
    userLng = parseFloat(rawLon);

    console.log(`🏠 DOM Parser read user base station coordinates: Lat(${rawLat}), Lon(${rawLon})`);

    if (globeElement) {
        myGlobe = Globe()(globeElement)
            .globeImageUrl('https://unpkg.com/three-globe/example/img/earth-day.jpg')
            .bumpImageUrl('https://unpkg.com/three-globe/example/img/earth-topology.png')
            .showAtmosphere(true)
            .atmosphereColor('#06b6d4')
            .atmosphereAltitude(0.15);

        // Orbit path setup
        myGlobe.pathPoints(d => d.coords);
        myGlobe.pathPointLat(p => p.lat);
        myGlobe.pathPointLng(p => p.lng !== undefined ? p.lng : p.lon);
        myGlobe.pathPointAlt(p => Math.max(p.alt, 0.05));
        myGlobe.pathColor(() => '#06b6d4');
        myGlobe.pathStroke(1.8);

        // Custom 3D sphere objects using globe.gl's internal THREE
        myGlobe.customThreeObject(d => {
            const color = d.isSatellite ? '#f43f5e' : '#4CD964';
            const size = d.isSatellite ? 0.8 : 0.4;
            return new THREE.Mesh(
                new THREE.SphereGeometry(size, 16, 16),
                new THREE.MeshBasicMaterial({ color })
            );
        });

        myGlobe.customThreeObjectUpdate((obj, d) => {
            Object.assign(obj.position, myGlobe.getCoords(d.lat, d.lng, d.alt));
        });
    }

    // Satellite selector sync from URL
    const urlParams = new URLSearchParams(window.location.search);
    const activeSatellite = urlParams.get('satellite');

    if (activeSatellite) {
        const satelliteDropdown = document.getElementById('satellite-select');
        if (satelliteDropdown) {
            satelliteDropdown.value = activeSatellite;
        }
    }

    fetchActiveOrbitPath();
    animateSatelliteNode();
});