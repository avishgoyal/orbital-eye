# Orbital Eye

Orbital Eye is a web-based real-time almost fully accurate Satellite Tracker which features international stations and satellites and displays them on an orbit on top of a 3d rendered WebGL Globe. This program is mainly catered towards astrophotographers like myself!

## Preview

https://github.com/user-attachments/assets/f7fae862-a5c4-46bd-bb06-842a909937ea

## Why I built it?

When I was thinking about projects to build, I got the idea of building Orbital Eye due to the struggles I face when I try to click pictures of Space stations or satellites.
Coincidentally, that is the same time when I came across Hack Club and Stardance! Normally, clicking a picture of any space station requires you to check whether the sun is at the right angle, the weather to see if clouds are blocking the way or not, the altitude angle at which the satellite is flowing by and the AQI/Light Pollution of the Area you are clicking a photograph in, which causes you to open multiple tabs on the browser. (Tools already do exist for this but one called Astroviewer doesn't have a great UI and the ones who do eat up your ram and GPU like its a buffet). Orbital Eye aims to consolidate all those tools to a simple UI and one who doesn't blow up your PC!

## A Photo I took using Orbital-Eye

Didn't think I would upload this photo since it was so bad, but since I clicked it using orbital-eye, I might as well. The Huge Shining star in the Top-right is the Chinese Space Station, I mean it should be according to orbital-eye...
![](/screenshots/trash_css_photo.jpg)
I took this photo in Himachal Pradesh, India. This was like day 1 of the project, when it used to only output passes in the terminal lol. (I used other tools alongside orbital-eye)

## Features

- Real-time satellite tracking
- Visibility levels prediction using weather, sunlight, and cloud cover
- Interactive 3D globe with the help of Globe.gl
- Live altitude and azimuth telemetry during a Pass
- Automatic location and timezone detection
- Support for the ISS, CSS, spacecraft, cubesats, and other orbital objects
- Camera lock mode
- Pass notification reminder
- Hide/Show UI mode
- Local satellite data caching for reliability

## How It Works

Orbital Eye uses Skyfield to calculate satellite positions from TLE (Two-Line Element) data fetched from Celestrak.

The backend:
- Downloads and caches orbital data (To parse faster for switches)
- Calculates future satellite passes using Skyfield API
- Predicts visibility conditions using OpenMeteo API for weather and Sunlight angle using Ephemeris
- Provides live telemetry during a Pass
- Provides Orbit path to map out orbit at the globe

The frontend:
- Gets the user's location through the browser
- Renders Earth, Orbit and Satellite using Globe.gl
- Animates satellites along calculated orbit paths
- Displays upcoming pass information and live tracking data

## Technologies Used

Backend:
- Python
- Flask
- Skyfield
- Celestrak TLE Data
- Open-Meteo API
- JPL DE421 Ephemeris


Front-End:
- HTML
- CSS
- JavaScript
- Globe.gl
- Three.js

## Repository Structure

```text
/orbital-eye
├── app.py
├── predictor.py
├── templates/
│   └── index.html
├── static/
│   ├── style.css
│   ├── script.js
│   └── earth_texture.jpg
├── screenshots/
├── requirements.txt
└── README.md
```

---

## Challenges

The hardest part of the project was getting the satellite visualization and orbit path rendering to line up correctly. Small differences in altitude scaling caused the orbit path and satellite marker to appear on different planes especially in 1080p Monitors and mobile phones(where it still doesn't work - working on it). 
Another challenge was handling situations where satellite data could not be downloaded. To make the application more reliable, I implemented local caching so previously downloaded orbital data can still be used.
(p.s One of the MOST DIFFICULT challenges I faced were none other than *drum roll please!!!*. typos!)

## Future Improvements

- More satellite categories
- Historical pass logging
- Better notification system (Using E-mail or some other service)
- Satellite photography planning tools (Ex- Ideal camera settings for this pass, things like exposure, shutter speed, etc.)
- Mobile-friendly controls (Definitely needed lol)

---

## Running Locally
Clone the repository:

```bash
git clone https://github.com/avishgoyal/orbital-eye.git
cd orbital-eye
pip install -r requirements.txt
```

Run the server:

```bash
python app.py
```

Open:

```text
http://127.0.0.1:5000
```

---
## Credits

* Celestrak for orbital data
* Open-Meteo for weather data
* SkyField API for doing the actual calculations
* Three.js and Globe.gl for globe visualisation
* icons.getbootstrap.com for providing SVGs for the buttons
* StackOverflow for some code snippets and doubt help (mainly for the satellite sphere visualisation)
* Stardance and Hack Club for providing me such a great platform!!!!

## License

```text
MIT License
```

Built by **Avish Goyal** 

