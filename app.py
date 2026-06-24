from flask import Flask, render_template, request, jsonify, session
from predictor import get_passes, get_live_telemetry, calculate_visibility, calculate_future_orbit_path, get_satellite_object, get_weather_forecast
import datetime
from zoneinfo import ZoneInfo

app = Flask(__name__)
app.secret_key = 'orbital-eye-super-secret-key-123'

def utc_to_local(skyfield_datetime, tz_str):
    utc_dt = skyfield_datetime.utc_datetime()
    return utc_dt.astimezone(ZoneInfo(tz_str)).strftime('%H:%M:%S')

@app.route('/set-location', methods=['POST'])
def set_location():
    data = request.get_json()
    if not data:
        return jsonify({"status": "error", "message": "No JSON payload"}), 400
    session['lat'] = float(data.get('latitude', 28.588))
    session['lon'] = float(data.get('longitude', 77.430))
    # FIX: JS sends 'elevation', not 'altitude' — read the correct key
    session['alt'] = float(data.get('elevation', data.get('altitude', 0)))
    session['tz']  = data.get('timezone', 'Asia/Kolkata')
    return jsonify({"status": "success"})

@app.route('/get-live-position')
def get_live_position():
    sat_name = request.args.get('satellite', 'ISS (ZARYA)')
    lat = session.get('lat', 28.588)
    lon = session.get('lon', 77.430)
    alt = session.get('alt', 205)

    sat_obj = get_satellite_object(sat_name)
    if not sat_obj:
        return jsonify({"error": f"Satellite '{sat_name}' not found in TLE cache."})
    return jsonify(get_live_telemetry(sat_obj, lat, lon, alt))

@app.route('/api/orbit/<satellite_name>')
def api_orbit_path(satellite_name):
    sat_obj = get_satellite_object(satellite_name.strip())
    if not sat_obj:
        return jsonify([])
    try:
        return jsonify(calculate_future_orbit_path(sat_obj))
    except Exception as e:
        print(f"Orbit calculation error: {e}")
        return jsonify([]), 500

@app.route('/api/custom-tle', methods=["POST"])
def process_custom_tle():
    data = request.json
    if not data or not all(k in data for k in ('name', 'line1', 'line2')):
        return jsonify({"error": "Missing name, line1, or line2"}), 400

    lat    = session.get('lat', 28.588)
    lon    = session.get('lon', 77.430)
    alt    = session.get('alt', 205)
    tz_str = session.get('tz', 'Asia/Kolkata')

    try:
        sat_obj      = get_satellite_object(data["name"], data["line1"], data["line2"])
        orbit_coords = calculate_future_orbit_path(sat_obj)
        raw_passes   = get_passes(sat_obj, lat, lon, alt)
    except Exception as e:
        print(f"Custom TLE processing error: {e}")
        return jsonify({"error": str(e)}), 500

    formatted_passes = []
    for p in raw_passes[:5]:
        formatted_passes.append({
            "date":    p['rise'].utc_datetime().strftime('%b %d'),
            "start":   utc_to_local(p['rise'],  tz_str),
            "end":     utc_to_local(p['set'],   tz_str),
            "max_alt": f"{p['max_alt']}°"
        })

    return jsonify({
        "trajectoryLines": orbit_coords,
        "passes":          formatted_passes
    })

@app.route('/')
def home():
    chosen_satellite = request.args.get('satellite', 'ISS (ZARYA)')
    lat    = session.get('lat', 28.588)
    lon    = session.get('lon', 77.430)
    alt    = session.get('alt', 205)
    tz_str = session.get('tz', 'Asia/Kolkata')

    sat_obj      = get_satellite_object(chosen_satellite)
    raw_passes   = get_passes(sat_obj, lat, lon, alt) if sat_obj else []
    weather_data = get_weather_forecast(lat, lon)

    localized_passes    = []
    next_pass_timestamp = 0

    if raw_passes:
        first_pass_dt       = raw_passes[0]['rise'].utc_datetime()
        epoch               = datetime.datetime(1970, 1, 1, tzinfo=datetime.timezone.utc)
        next_pass_timestamp = int((first_pass_dt - epoch).total_seconds() * 1000)

        for p in raw_passes:
            localized_passes.append({
                "rise":       f"{utc_to_local(p['rise'],  tz_str)} ({p['rise_dir']})",
                "peak":       f"{utc_to_local(p['peak'],  tz_str)} ({p['peak_dir']})",
                "max_alt":    p['max_alt'],
                "set":        f"{utc_to_local(p['set'],   tz_str)} ({p['set_dir']})",
                "visibility": calculate_visibility(sat_obj, lat, lon, alt, p['peak'], p['max_alt'], weather_data)
            })

    return render_template('index.html',
                           passes=localized_passes,
                           next_pass=bool(localized_passes),
                           next_pass_time=next_pass_timestamp,
                           current_lat=lat,
                           current_lon=lon,
                           current_sat=chosen_satellite)

if __name__ == '__main__':
    app.run(debug=True)