from flask import Flask, render_template, request, jsonify, session
from predictor import get_passes, get_live_telemetry, calculate_visibility, calculate_future_orbit_path, get_satellite_object
import datetime
from datetime import timedelta
from zoneinfo import ZoneInfo

app = Flask(__name__)

def utc_to_local(skyfield_datetime, tz_str):
    utc_dt = skyfield_datetime.utc_datetime()
    local_time = utc_dt.astimezone(ZoneInfo(tz_str))
    return local_time.strftime('%H:%M:%S')

#new route for post method so that we can dynamically fetch coordinates from the client
@app.route('/set-location', \
           methods=['POST'])
def set_location():
    data = request.get_json()
    session['lat'] = float(data.get('latitude'))
    session['lon'] = float(data.get('longitude'))
    session['alt'] = float(data.get('altitude', 0))
    session['tz'] = data.get('timezone', 'Asia/Kolkata')
    return jsonify({"status": "success"})

@app.route('/get-live-position')
def get_live_position():
    chosen_satellite = request.args.get('satellite', 'ISS (ZARYA)')
    lat = session.get('lat', 28.588)
    lon = session.get('lon', 77.430)
    alt = session.get('alt', 205)
    
    telemetry = get_live_telemetry(chosen_satellite, lat, lon, alt)
    return jsonify(telemetry)

@app.route('/api/orbit/<satellite_name>')
def api_orbit_path(satellite_name):
    clean_satellite_name = satellite_name.strip()
    sat_obj = get_satellite_object(clean_satellite_name)
    
    # FIXED: Added a defensive catch so the server doesn't crash if an asset is missing
    if not sat_obj:
        return jsonify([])
        
    path_data = calculate_future_orbit_path(sat_obj)
    return jsonify(path_data)

@app.route('/')
def home():
    # Fetching data from celstrak
    url = "https://celestrak.org/NORAD/elements/stations.txt"
    chosen_satellite = request.args.get('satellite', 'ISS (ZARYA)')
    lat = session.get('lat', 28.588)
    lon = session.get('lon', 77.430)
    alt = session.get('alt', 205)
    tz_str = session.get('tz', 'Asia/Kolkata')
    raw_passes = get_passes(url, chosen_satellite, lat, lon, alt)

    next_pass_timestamp = 0
    if raw_passes:
        first_pass = raw_passes[0]
        dt = first_pass['rise'].utc_datetime()
        next_pass_timestamp = int((dt - datetime.datetime(1970, 1, 1, tzinfo=datetime.timezone.utc)).total_seconds() * 1000)

    localized_passes = []

    for p in raw_passes:
        pass_visibility = calculate_visibility(
            satellite_name=chosen_satellite, 
            lat=lat,
            lon=lon,
            alt=alt,
            time_obj=p['peak'],
            max_alt=p['max_alt']
        )

        localized_passes.append({
            "rise": f"{utc_to_local(p['rise'], tz_str)} ({p['rise_dir']})",
            "peak": f"{utc_to_local(p['peak'], tz_str)} ({p['peak_dir']})",
            "max_alt": p['max_alt'],
            "set": f"{utc_to_local(p['set'], tz_str)} ({p['set_dir']})",
            "visibility": pass_visibility
        })

    # Passing the elements straight to the frontend template
    return render_template('index.html', 
                           passes=localized_passes, 
                           next_pass=True if localized_passes else False, 
                           next_pass_time=next_pass_timestamp,
                           current_lat=lat,
                           current_lon=lon,
                           current_sat=chosen_satellite)


app.secret_key = 'orbital-eye-super-secret-key-123'
if __name__ == '__main__':
    app.run(debug=True)