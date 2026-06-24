import requests
import os
import datetime
from datetime import timedelta
from skyfield.api import load, EarthSatellite, wgs84

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# GLOBAL INITIALIZATION (Do this once, not in every function)
ts = load.timescale()
eph = load('de421.bsp')
local_cache = os.path.join(BASE_DIR, "stations.txt")

def degrees_to_cardinal(degrees):
    cardinals = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]
    index = round(degrees / 45) % 8
    return cardinals[index]

def get_satellite_object(name, line1=None, line2=None):
    """Returns a Skyfield EarthSatellite object. Supports cached strings or custom TLEs."""
    if line1 and line2:
        return EarthSatellite(line1, line2, name, ts)
        
    if not os.path.exists(local_cache): return None
    with open(local_cache, "r") as f:
        lines = f.read().splitlines()
    for i in range(len(lines)):
        if lines[i].strip().replace('\xa0', ' ') == name.strip():
            return EarthSatellite(lines[i+1], lines[i+2], name, ts)
    return None

def get_weather_forecast(lat, lon):
    """Fetches a 48-hour cloud cover forecast ONCE to prevent N+1 API blocking."""
    try:
        api_url = f"https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}&hourly=cloud_cover&timeformat=unixtime&forecast_days=2"
        response = requests.get(api_url, timeout=4)
        return response.json()
    except Exception as e:
        print(f"Weather API failed: {e}")
        return None

def get_passes(sat_obj, lat=28.588, lon=77.430, alt=205):
    if not sat_obj: return []
    
    observer = wgs84.latlon(lat, lon, alt)
    t0 = ts.now()
    t1 = ts.from_datetime(t0.utc_datetime() + timedelta(days=2))

    times, event_types = sat_obj.find_events(observer, t0, t1, altitude_degrees=10.0)
    completed_passes = []
    current_pass = {}
    
    for time, event in zip(times, event_types):
        difference = (sat_obj - observer).at(time)
        alt_deg, az, _ = difference.altaz()

        if event == 0:
            current_pass = {"rise": time, "rise_dir": degrees_to_cardinal(az.degrees)}
        elif event == 1 and "rise" in current_pass:
            current_pass["peak"] = time
            current_pass["max_alt"] = round(alt_deg.degrees, 1)
            current_pass["peak_dir"] = degrees_to_cardinal(az.degrees)
        elif event == 2 and "peak" in current_pass:
            current_pass["set"] = time
            current_pass["set_dir"] = degrees_to_cardinal(az.degrees)
            completed_passes.append(current_pass)
            current_pass = {}
            
    return completed_passes

def calculate_visibility(sat_obj, lat, lon, alt, time_obj, max_alt, weather_data):
    location = wgs84.latlon(lat, lon, alt)
    pass_timestamp = time_obj.utc_datetime().timestamp()

    cloud_cover = None
    if weather_data and "hourly" in weather_data:
        hourly_times = weather_data["hourly"]["time"]
        hourly_clouds = weather_data["hourly"]["cloud_cover"]
        closest_index = min(range(len(hourly_times)), key=lambda i: abs(hourly_times[i] - pass_timestamp))
        cloud_cover = hourly_clouds[closest_index]

    is_satellite_sunlit = sat_obj.at(time_obj).is_sunlit(eph)
    sun_altaz = (eph['earth'] + location).at(time_obj).observe(eph['sun']).apparent().altaz()
    
    if sun_altaz[0].degrees > -6: return "INVISIBLE (Daylight)"
    if not is_satellite_sunlit: return "INVISIBLE (Eclipsed)"
    if max_alt < 20: return "FAIR (Too Low)"
    if cloud_cover is not None and cloud_cover > 75: return f"POOR ({cloud_cover}% Clouds)"
    if cloud_cover is not None and cloud_cover < 20 and max_alt > 45: return "EXCELLENT"
    return "GOOD"

def calculate_future_orbit_path(sat_obj, total_minutes=276, step_seconds=30):
    orbit_path_array = []
    start_time = ts.now()
    total_steps = int((total_minutes * 60) / step_seconds)

    for step in range(total_steps):
        future_time = ts.tt_jd(start_time.tt + (step * step_seconds) / 86400)
        subpoint = sat_obj.at(future_time).subpoint()
        orbit_path_array.append({
            "lat": round(subpoint.latitude.degrees, 4),
            "lng": round(subpoint.longitude.degrees, 4),
            "alt": round(subpoint.elevation.km / 6371.0, 6)
        })
    return orbit_path_array

def get_live_telemetry(sat_obj, lat, lon, alt):
    if not sat_obj: return {"error": "Satellite asset not found."}
    
    observer = wgs84.latlon(lat, lon, alt)
    difference = (sat_obj - observer).at(ts.now())
    alt_deg, az, _ = difference.altaz()

    return {
        "alt": round(alt_deg.degrees, 1),
        "az": round(az.degrees, 1),
        "dir": degrees_to_cardinal(az.degrees),
        "above_horizon": alt_deg.degrees > 10.0
    }