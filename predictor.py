import requests
import os
from skyfield.api import load, EarthSatellite, wgs84
from datetime import timedelta
import datetime

def degrees_to_cardinal(degrees):
        cardinals = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]
        index = round(degrees / 45) % 8
        return cardinals[index]

def get_passes(url: str, name: str, custom_lat= 28.588, custom_lon= 77.430, custom_alt= 205):
    ts = load.timescale()
    local_cache = "stations.txt"

    def fetch_satellite(url: str, name, ts):
        lines = []
        try:
            # Download attempt for TLE with a fallback local cache (celestrak sometimes goes down)
            response = requests.get(url, timeout=5)
            if response.status_code == 200:
                lines = response.text.splitlines()
                # Cache it locally for future fallbacks
                with open(local_cache, "w") as f:
                    f.write(response.text)
        except Exception as e:
            print(f"Celestrak network timeout or issue ({e}).")

        # fall back logic
        if not lines and os.path.exists(local_cache):
            print("💾 Loading satellite data from local cache.")
            with open(local_cache, "r") as f:
                lines = f.read().splitlines()

        if not lines:
            print("Error: No online connection or local cache data available.")
            return None

        for i in range(len(lines)):
            if lines[i].strip() == name:
                line1 = lines[i+1]
                line2 = lines[i+2]
                return EarthSatellite(line1, line2, name, ts)
        return None

    observer = wgs84.latlon(custom_lat, custom_lon, custom_alt)

    t0 = ts.now()
    t1 = ts.from_datetime(t0.utc_datetime() + timedelta(days=2))

    iss = fetch_satellite(url, name, ts)
    
    # Handle case if satellite parsing completely fails due to lack of network/cache
    if not iss:
        return []

    times, event_types = iss.find_events(observer, t0, t1, altitude_degrees=10.0)
    completed_passes = []
    current_pass = {}
    for time, event in zip(times, event_types):
        difference = (iss - observer).at(time)
        alt, az, distance = difference.altaz()

        if event == 0:
            current_pass = {"rise": time, "rise_dir": degrees_to_cardinal(az.degrees)}
        
        elif event == 1:
            if "rise" in current_pass:
                current_pass["peak"] = time
                difference = (iss - observer).at(time)
                alt, az, distance = difference.altaz()
                current_pass["max_alt"] = round(alt.degrees, 1)
                current_pass["peak_dir"] = degrees_to_cardinal(az.degrees)
        
        elif event == 2:
            if "rise" in current_pass and "peak" in current_pass:
                current_pass["set"] = time
                current_pass["set_dir"] = degrees_to_cardinal(az.degrees)
                completed_passes.append(current_pass)
            current_pass = {}
    
    return completed_passes

def get_live_telemetry(name, custom_lat=28.588, custom_lon=77.430, custom_alt=205):
    ts = load.timescale()
    local_cache = "stations.txt"

    if not os.path.exists(local_cache):
        return {"error": "no local data available"}

    with open(local_cache, "r") as f:
        lines = f.read().splitlines()

    sat_obj = None # Prevents UnboundLocalError
    for i in range(len(lines)):
        # FIXED: Replaced undefined 'clean_target' with name.strip()
        if lines[i].strip().replace('\xa0', ' ') == name.strip():
            line1 = lines[i+1]
            line2 = lines[i+2]
            sat_obj = EarthSatellite(line1, line2, name, ts)
            break

    if not sat_obj:
        return {"error": "Satellite asset not found in cache."}

    observer = wgs84.latlon(custom_lat, custom_lon, custom_alt)
    time_now = ts.now()
    difference = (sat_obj - observer).at(time_now)
    alt, az, distance = difference.altaz()

    return {
        "alt": round(alt.degrees, 1),
        "az": round(az.degrees, 1),
        "dir": degrees_to_cardinal(az.degrees),
        "above_horizon": alt.degrees > 10.0
    }
    
eph = load('de421.bsp')
def calculate_visibility(satellite_name, lat, lon, alt, time_obj, max_alt):
    ts = load.timescale()
    local_cache = "stations.txt"
    sat_obj = None
    
    # Extract the true mathematical satellite object from the cached file strings
    if os.path.exists(local_cache):
        with open(local_cache, "r") as f:
            lines = f.read().splitlines()
        for i in range(len(lines)):
            if lines[i].strip() == satellite_name:
                line1 = lines[i+1]
                line2 = lines[i+2]
                sat_obj = EarthSatellite(line1, line2, satellite_name, ts)
                break

    if not sat_obj:
        return "UNKNOWN ASSET"

    # Define the observer location point dynamically using raw coordinate numbers
    location = wgs84.latlon(lat, lon, alt)
    pass_datetime = time_obj.utc_datetime()
    pass_timestamp = pass_datetime.timestamp()

    try:
        # FIXED: Removed the invalid '.degrees' properties on raw floats
        api_url = f"https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}&hourly=cloud_cover&timeformat=unixtime&forecast_days=2"
        response = requests.get(api_url, timeout=4)
        data = response.json()  # FIXED: Fixed the 'date' dictionary naming typo

        hourly_times = data["hourly"]["time"]
        hourly_clouds = data["hourly"]["cloud_cover"]

        # FIXED: Restored the target timestamp comparison matching loop
        closest_index = min(range(len(hourly_times)), key=lambda i: abs(hourly_times[i] - pass_timestamp))
        cloud_cover = hourly_clouds[closest_index]

        print(f"⏰ Pass Time: {pass_datetime} UTC | Matched Forecast Hour: {datetime.datetime.fromtimestamp(hourly_times[closest_index], datetime.timezone.utc)} | Predicted Clouds: {cloud_cover}%")

    except Exception as e:
        print(f"Predictive weather API lookup failed: {e}")
        cloud_cover = None 

    # Checking if satellite is hit by direct sunlight
    is_satellite_sunlit = sat_obj.at(time_obj).is_sunlit(eph)

    # Solar position math relative to the observer location coordinates
    sun_altaz = (eph['earth'] + location).at(time_obj).observe(eph['sun']).apparent().altaz()
    sun_alt = sun_altaz[0].degrees

    # --- CRITERIA VISIBILITY MATRIX ---
    if cloud_cover is not None and cloud_cover > 75:
        return f"POOR ({cloud_cover}% Clouds)"

    if max_alt < 20:
        return "FAIR (Too Low)"

    if sun_alt > -6:
        return "INVISIBLE (Daylight)"
        
    if not is_satellite_sunlit:  # FIXED: Variable updated to match definition name
        return "INVISIBLE (Eclipsed)"
        
    if cloud_cover is not None and cloud_cover < 20 and max_alt > 45:
        return "EXCELLENT"
        
    return "GOOD"

    
def calculate_future_orbit_path(satellite_object, total_minutes=276, step_seconds=30):
    orbit_path_array = []
    ts = load.timescale()
    start_time = ts.now()
    total_steps = int((total_minutes * 60) / step_seconds)

    for step in range(total_steps):
        future_time = ts.tt_jd(start_time.tt + (step * step_seconds) / 86400)
        geocentric_position = satellite_object.at(future_time)
        subpoint = geocentric_position.subpoint()
        orbit_path_array.append({
            "lat": round(subpoint.latitude.degrees, 4),
            "lng": round(subpoint.longitude.degrees, 4),
            "alt": round(subpoint.elevation.km / 6371.0, 6)
        })

    return orbit_path_array

# HELPER FUNCTIONS

def get_satellite_object(satellite_name):
    """Loads a specific satellite from the local cache file and returns a Skyfield object."""
    local_cache = "stations.txt"
    ts = load.timescale()
    
    if os.path.exists(local_cache):
        with open(local_cache, "r") as f:
            lines = f.read().splitlines()
        
        for i in range(len(lines)):
            if lines[i].strip() == satellite_name.strip():
                line1 = lines[i+1]
                line2 = lines[i+2]
                # Return the instantiated Skyfield object
                return EarthSatellite(line1, line2, satellite_name, ts)
                
    # if name was not found we return none
    return None