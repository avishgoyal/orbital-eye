// ─── GLOBALS ────────────────────────────────────────────────────────────────
let myGlobe;
let orbitPoints       = [];
let currentPathIndex  = 0;
let animationProgress = 0.0;
const animationSpeed  = 0.002;

let userLat = null;
let userLng = null;

let liveTrackingInterval = null;


// ─── GEOLOCATION ─────────────────────────────────────────────────────────────
function getUserLocation() {
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(sendLocationToServer, handleError);
    } else {
        console.log("Geolocation not supported by this browser.");
    }
}

function sendLocationToServer(position) {
    const lat = position.coords.latitude;
    const lon = position.coords.longitude;
    const alt = position.coords.altitude || 0;
    const tz  = Intl.DateTimeFormat().resolvedOptions().timeZone;

    const serverLat = parseFloat(document.body.getAttribute('data-current-lat'));
    const serverLon = parseFloat(document.body.getAttribute('data-current-lon'));

    // Skip if position hasn't meaningfully changed
    if (serverLat && serverLon &&
        Math.abs(lat - serverLat) < 0.01 &&
        Math.abs(lon - serverLon) < 0.01) {
        console.log("Location unchanged. Skipping reload loop.");
        return;
    }

    console.log(`New location detected — Lat ${lat}, Lon ${lon}`);

    fetch('/set-location', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Key is 'elevation' — matches Flask data.get('elevation')
        body: JSON.stringify({ latitude: lat, longitude: lon, elevation: alt, timezone: tz })
    })
    .then(r => r.json())
    .then(data => { if (data.status === 'success') window.location.reload(); })
    .catch(err => console.warn("Location sync failed:", err));
}

function handleError(error) {
    console.warn(`Location access denied or unavailable: ${error.message}`);
}


// ─── CANVAS OVERLAY ──────────────────────────────────────────────────────────
function drawOverlay(nodes) {
    const canvas    = document.getElementById('overlay-canvas');
    const container = document.getElementById('globe-container');
    if (!canvas || !container || !myGlobe) return;

    // FIX: Only reset canvas dimensions on actual resize — prevents 60fps layout thrashing
    if (canvas.width !== container.offsetWidth || canvas.height !== container.offsetHeight) {
        canvas.width  = container.offsetWidth;
        canvas.height = container.offsetHeight;
    }

    const ctx    = canvas.getContext('2d');
    const camera = myGlobe.camera();

    // FIX: Source Vec3 constructor from camera — guaranteed to exist at init time
    const Vec3 = camera.position.constructor;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Projects a geo coordinate to a 2D canvas pixel.
    // Returns null if the point is behind the globe (dot-product occlusion).
    function projectToScreen(lat, lng, altGlobe) {
        const pos3d = myGlobe.getCoords(lat, lng, altGlobe);
        if (!pos3d) return null;

        // FIX: Dot-product occlusion — cull points on the back hemisphere
        const cam = camera.position;
        const dot = cam.x * pos3d.x + cam.y * pos3d.y + cam.z * pos3d.z;
        if (dot < 0) return null;

        const vec = new Vec3(pos3d.x, pos3d.y, pos3d.z);
        vec.project(camera);
        if (vec.z > 1) return null; // behind near clip plane

        return {
            x: (vec.x *  0.5 + 0.5) * canvas.width,
            y: (vec.y * -0.5 + 0.5) * canvas.height
        };
    }

    // ── FOV RING ────────────────────────────────────────────────────────────
    if (userLat !== null && !isNaN(userLat) && userLng !== null && !isNaN(userLng)) {
        const FOV_DEG = 14; // ~1,500 km naked-eye horizon radius
        const ringPoints = [];

        for (let bearing = 0; bearing < 360; bearing += 5) {
            const rad    = bearing * Math.PI / 180;
            const latRad = userLat  * Math.PI / 180;
            const fovRad = FOV_DEG  * Math.PI / 180;

            // Spherical cap geometry — proper haversine offset from observer
            const pLat = Math.asin(
                Math.sin(latRad) * Math.cos(fovRad) +
                Math.cos(latRad) * Math.sin(fovRad) * Math.cos(rad)
            );
            const pLng = userLng * Math.PI / 180 + Math.atan2(
                Math.sin(rad)    * Math.sin(fovRad) * Math.cos(latRad),
                Math.cos(fovRad) - Math.sin(latRad) * Math.sin(pLat)
            );

            const pt = projectToScreen(pLat * 180 / Math.PI, pLng * 180 / Math.PI, 0);
            if (pt) ringPoints.push(pt);
        }

        if (ringPoints.length > 2) {
            // FIX: Track gaps (ring going behind globe). If a gap exists,
            // do NOT call closePath() — it would draw a diagonal line across the globe.
            let hadGap = false;

            ctx.beginPath();
            ctx.moveTo(ringPoints[0].x, ringPoints[0].y);

            for (let i = 1; i < ringPoints.length; i++) {
                const dx   = ringPoints[i].x - ringPoints[i - 1].x;
                const dy   = ringPoints[i].y - ringPoints[i - 1].y;
                const dist = Math.sqrt(dx * dx + dy * dy);

                if (dist > canvas.width * 0.3) {
                    // Large screen-space jump = ring passed behind globe
                    ctx.moveTo(ringPoints[i].x, ringPoints[i].y);
                    hadGap = true;
                } else {
                    ctx.lineTo(ringPoints[i].x, ringPoints[i].y);
                }
            }

            if (!hadGap) {
                ctx.closePath();
                // Only fill when the ring is fully visible — partial fills look wrong
                ctx.fillStyle = 'rgba(0, 255, 120, 0.06)';
                ctx.fill();
            }

            ctx.strokeStyle = 'rgba(0, 255, 120, 0.9)';
            ctx.lineWidth   = 2;
            ctx.setLineDash([6, 4]);
            ctx.stroke();
            ctx.setLineDash([]); // reset dash for subsequent draws
        }
    }

    // ── SATELLITE & GROUND STATION DOTS ─────────────────────────────────────
    nodes.forEach(node => {
        const screen = projectToScreen(node.lat, node.lng, node.alt);
        if (!screen) return;

        const radius = node.isSatellite ? 5 : 4;
        const color  = node.isSatellite ? '#f43f5e' : '#4CD964';

        // Glow ring
        ctx.beginPath();
        ctx.arc(screen.x, screen.y, radius + 4, 0, Math.PI * 2);
        ctx.fillStyle = node.isSatellite ? 'rgba(244,63,94,0.2)' : 'rgba(76,217,100,0.2)';
        ctx.fill();

        // Solid dot
        ctx.beginPath();
        ctx.arc(screen.x, screen.y, radius, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
    });
}


// ─── ORBIT DATA ───────────────────────────────────────────────────────────────
async function fetchActiveOrbitPath() {
    const selectBox = document.getElementById('satellite-select');
    if (!selectBox || !myGlobe) return;

    const activeSatName = selectBox.value;
    console.log(`Fetching orbit path for: ${activeSatName}`);

    try {
        const response = await fetch(`/api/orbit/${encodeURIComponent(activeSatName)}`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        orbitPoints = await response.json();

        if (Array.isArray(orbitPoints) && orbitPoints.length > 0) {
            myGlobe.pathsData([{ coords: orbitPoints }]);
            console.log(`Mapped ${orbitPoints.length} orbit coordinates.`);
            currentPathIndex  = 0;
            animationProgress = 0.0;
        } else {
            console.warn("Orbit points array came back empty.");
        }
    } catch (err) {
        console.error("Failed to fetch orbit path:", err);
    }
}


// ─── SATELLITE ANIMATION LOOP ────────────────────────────────────────────────
function animateSatelliteNode() {
    // Wait for globe to finish initialising before running
    if (!myGlobe) {
        requestAnimationFrame(animateSatelliteNode);
        return;
    }

    const activeTrackingNodes = [];

    // Satellite interpolation
    if (orbitPoints && orbitPoints.length >= 2) {
        const startPoint = orbitPoints[currentPathIndex];
        const endPoint   = orbitPoints[currentPathIndex + 1];

        if (endPoint) {
            const sLat = startPoint.lat;
            const sLng = startPoint.lng ?? startPoint.lon;
            const eLat = endPoint.lat;
            const eLng = endPoint.lng ?? endPoint.lon;
            const sAlt = startPoint.alt || 0.06;
            const eAlt = endPoint.alt   || 0.06;

            const interpolatedLat = sLat + (eLat - sLat) * animationProgress;
            const interpolatedLng = sLng + (eLng - sLng) * animationProgress;
            const interpolatedAlt = sAlt + (eAlt - sAlt) * animationProgress;
            activeTrackingNodes.push({
                lat: interpolatedLat,
                lng: interpolatedLng,
                alt: interpolatedAlt,
                isSatellite: true
            });

            // camera lock logic
            if (cameraLocked) {
                myGlobe.pointOfView(
                    {
                        lat: interpolatedLat,
                        lng: interpolatedLng,
                        altitude: 0.6
                    },
                    100 // it helps to smoothen transition so it doesnt feel so jittery
                );
            }

            animationProgress += animationSpeed;

            if (animationProgress >= 1.0) {
                animationProgress = 0.0;
                currentPathIndex++;
            }
        } else {
            // Reached end of path — loop back
            currentPathIndex  = 0;
            animationProgress = 0.0;
        }
    }

    // Ground station dot
    if (userLat !== null && !isNaN(userLat) && userLng !== null && !isNaN(userLng)) {
        activeTrackingNodes.push({
            lat:         userLat,
            lng:         userLng,
            alt:         0.005,
            isSatellite: false
        });
    }

    drawOverlay(activeTrackingNodes);
    requestAnimationFrame(animateSatelliteNode);
}


// ─── COUNTDOWN & LIVE PASS TELEMETRY ─────────────────────────────────────────
function update_countdown() {
    const el = document.getElementById('countdown');
    if (!el) return;

    const targetAttr = el.getAttribute('date-time');
    if (!targetAttr || targetAttr === "0") return;

    const diff = parseInt(targetAttr, 10) - Date.now();

    if (diff <= 0) {
        if (!liveTrackingInterval) {
            const sat = new URLSearchParams(window.location.search).get('satellite') || 'ISS (ZARYA)';
            startLiveTracking(sat, el);
        }
        return;
    }

    const hrs  = Math.floor(diff / 3600000);
    const mins = Math.floor((diff % 3600000) / 60000);
    const secs = Math.floor((diff % 60000)   / 1000);

    el.innerHTML =
        `${String(hrs).padStart(2,'0')}h ` +
        `${String(mins).padStart(2,'0')}m ` +
        `${String(secs).padStart(2,'0')}s`;
}

function startLiveTracking(satelliteName, displayElement) {
    console.log(`🔴 Starting live tracking: ${satelliteName}`);
    displayElement.style.color = "#FF3B30";

    function fetchTelemetry() {
        fetch(`/get-live-position?satellite=${encodeURIComponent(satelliteName)}`)
        .then(r => r.json())
        .then(data => {
            if (data.error) {
                displayElement.innerHTML = "LIVE TELEMETRY UNAVAILABLE";
                return;
            }
            if (data.above_horizon) {
                displayElement.innerHTML = `
                    <div class="live-pulse-container">
                        <span class="pulse-dot"></span> LIVE OVERHEAD PASS
                    </div>
                    <div class="live-telemetry">
                        ALT: <span class="telem-green">${data.alt}°</span> &nbsp;|&nbsp;
                        AZ: <span class="telem-blue">${data.az}° (${data.dir})</span>
                    </div>`;
            } else {
                displayElement.innerHTML = "PASS COMPLETED. ADJUSTING LOGS...";
                clearInterval(liveTrackingInterval);
                liveTrackingInterval = null;
                setTimeout(() => window.location.reload(), 3000);
            }
        })
        .catch(() => { displayElement.innerHTML = "TELEMETRY SIGNAL LOST"; });
    }

    fetchTelemetry();
    liveTrackingInterval = setInterval(fetchTelemetry, 2000);
}

function switchSatellite(satelliteName) {
    window.location.href = `/?satellite=${encodeURIComponent(satelliteName)}`;
}


// ─── LIFECYCLE ────────────────────────────────────────────────────────────────
window.onload = function () {
    getUserLocation();
    update_countdown();
    setInterval(update_countdown, 1000);
};

document.addEventListener("DOMContentLoaded", () => {
    const globeElement = document.getElementById('globe-container');

    const rawLat = document.body.getAttribute('data-current-lat');
    const rawLon = document.body.getAttribute('data-current-lon');
    userLat = parseFloat(rawLat);
    userLng = parseFloat(rawLon);
    console.log(`🏠 Base station: Lat(${rawLat}), Lon(${rawLon})`);

    if (globeElement) {
        myGlobe = Globe()(globeElement)
            .globeImageUrl('/static/earth_texture.jpg')
            .backgroundImageUrl('//cdn.jsdelivr.net/npm/three-globe/example/img/night-sky.png')
            .bumpImageUrl('https://unpkg.com/three-globe/example/img/earth-topology.png')
            .showAtmosphere(true)
            .atmosphereColor('#06b6d4')
            .atmosphereAltitude(0.15);

        // Orbit path
        myGlobe.pathPoints(d => d.coords);
        myGlobe.pathPointLat(p => p.lat);
        myGlobe.pathPointLng(p => p.lng !== undefined ? p.lng : p.lon);
        myGlobe.pathPointAlt(p => Math.max(p.alt, 0.064));
        myGlobe.pathColor(() => '#06b6d4');
        myGlobe.pathStroke(1);

        // Resize observer — resets canvas size cache when container changes
        const canvas = document.getElementById('overlay-canvas');
        if (canvas && window.ResizeObserver) {
            new ResizeObserver(() => {
                // Force dimension update on next drawOverlay call
                canvas.width  = 0;
                canvas.height = 0;
            }).observe(globeElement);
        }
    }

    // Sync dropdown to URL param
    const activeSatellite = new URLSearchParams(window.location.search).get('satellite');
    if (activeSatellite) {
        const dropdown = document.getElementById('satellite-select');
        if (dropdown) dropdown.value = activeSatellite;
    }

    fetchActiveOrbitPath();
    animateSatelliteNode();

    // ── CUSTOM TLE HANDLER ──────────────────────────────────────────────────
    const injectBtn = document.getElementById('inject-tle-btn');
    if (!injectBtn) return; // guard — element must exist

    injectBtn.addEventListener('click', async () => {
        const rawInput  = document.getElementById('raw-tle-input').value.trim();
        const statusDiv = document.getElementById('injector-status');

        const lines = rawInput.split('\n').map(l => l.trim()).filter(l => l.length > 0);

        if (lines.length !== 3) {
            statusDiv.className = 'status-text error';
            statusDiv.innerText = 'ERROR: Must be exactly 3 lines.';
            return;
        }

        statusDiv.className = 'status-text';
        statusDiv.innerText = 'PARSING ORBITAL ENGINE...';

        const payload = { name: lines[0], line1: lines[1], line2: lines[2] };

        try {
            const response = await fetch('/api/custom-tle', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify(payload)
            });

            if (!response.ok) throw new Error(`Server error ${response.status}`);

            const data = await response.json();

            // Swap orbit path
            orbitPoints = data.trajectoryLines;
            myGlobe.pathTransitionDuration(300);
            myGlobe.pathsData([{ coords: orbitPoints }]);
            currentPathIndex  = 0;
            animationProgress = 0.0;

            // Update HUD title
            document.getElementById('active-asset-title').innerText =
                `ACTIVE ASSET: ${payload.name.toUpperCase()}`;

            // Freeze countdown
            const cdEl = document.getElementById('countdown');
            if (cdEl) {
                cdEl.innerText = "TRACKING INJECTED COORDS";
                cdEl.setAttribute('date-time', '0');
            }

            // Rebuild pass table
            const tbody      = document.getElementById('pass-table-body');
            const passDetails = document.getElementById('pass-details');

            if (tbody) {
                tbody.innerHTML = '';

                if (!data.passes || data.passes.length === 0) {
                    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:20px;color:#8892b0;">No visible windows in next 48h.</td></tr>`;
                    if (passDetails) passDetails.innerHTML = '<p style="color:#ff4a4a;">No upcoming passes calculated.</p>';
                } else {
                    if (passDetails) {
                        passDetails.innerHTML = `
                            <p><strong>Visibility:</strong> <span style="color:#00ff78;">Calculated Pass</span></p>
                            <p><strong>Max Elevation:</strong> <span>${data.passes[0].max_alt}</span></p>
                            <p><strong>Rise Window:</strong> <span>${data.passes[0].date} @ ${data.passes[0].start}</span></p>`;
                    }
                    data.passes.forEach(p => {
                        const row = document.createElement('tr');
                        row.innerHTML = `
                            <td>${p.start}</td>
                            <td>--:--:--</td>
                            <td class="accent-text">${p.max_alt}</td>
                            <td>${p.end}</td>
                            <td><span class="badge good-vis">${p.date}</span></td>`;
                        tbody.appendChild(row);
                    });
                }
            }

            statusDiv.className = 'status-text success';
            statusDiv.innerText = 'TARGET INJECTED SUCCESSFULLY.';

        } catch (err) {
            console.error("TLE injection failed:", err);
            statusDiv.className = 'status-text error';
            statusDiv.innerText = 'INJECTION FAILED. CHECK CONSOLE.';
        }
    });
});

// Hide UI button logic
btn = document.getElementById('hide-ui-btn')
const uiBtnText = document.getElementById('hide-ui-text');
let hidden = false;

btn.addEventListener('click', () => {
    hidden = !hidden;

    document.getElementById('left-hud').classList.toggle('hidden-ui');
    document.getElementById('right-hud').classList.toggle('hidden-ui');
    document.getElementById('bottom-right-hud').classList.toggle('hidden-ui');
    document.getElementById('tle-injector-card').classList.toggle('hidden-ui');

    uiBtnText.textContent = hidden ? 'SHOW UI' : 'HIDE UI';
});

btn = document.getElementById('camera-lock-button')
const cameraBtnText = document.getElementById('camera-lock-text');
let cameraLocked = false;

btn.addEventListener('click', () => {
    cameraLocked = !cameraLocked

    // prevents people to be able to move the globe
    if (cameraLocked) {
    myGlobe.controls().autoRotate = false;
    }
    // rest of the logic is in animate satellite node function
    cameraBtnText.textContent = cameraLocked ? 'UNLOCK CAMERA' : 'LOCK CAMERA';
});

btn = document.getElementById('notifications-button')
const notificationBtnText = document.getElementById('notifications-text');
let notificationsEnabled = false;
let notificationTimeout = null;
function notifyUser() {
    alert('PASS IN 2 MINUTES!!!!!')
    notificationsEnabled = false
    notificationBtnText.textContent = 'NOTIFY ME';
}

btn.addEventListener('click', () => {
    notificationsEnabled = !notificationsEnabled
    const el = document.getElementById('countdown');
    const targetAttr = el.getAttribute('date-time');
    const diff = parseInt(targetAttr, 10) - Date.now();
    if (notificationTimeout) {
        clearTimeout(notificationTimeout);
    }
    notificationTimeout = setTimeout(() => notifyUser(), 12000) // 120 seconds
    notificationBtnText.textContent = notificationsEnabled ? 'DONT NOTIFY ME' : 'NOTIFY ME';
});