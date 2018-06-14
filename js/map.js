// map.js to work with data and canvas
'use strict';

mapboxgl.accessToken = 'pk.eyJ1IjoiamV0aXhjIiwiYSI6ImNqY3RieGI1MTBjczYycW83Zmp4bHdqa2cifQ.OENJ8BzwxHZS1weoc7WiLA';

// identifying new map
var map = new mapboxgl.Map({
    container: 'map',
    style: 'mapbox://styles/jetixc/cjdukar4b59gc2rnrdsby2396',
    center: [137.842997, 36.636182], // starting position [lng, lat]
    zoom: 6 // starting zoom
});


map.on('load', function () {

    // D3 to help us make the ajax request
    d3.json('./data/query.json', function (err, data) {

        if (err) throw err;

        // Create a year property value based on time used to filter against
        data.features = data.features.map (function (d) {
            d.properties.fyear = new Date(d.properties.time).getFullYear();
            return d;
        });

        // Adding source with dots
        map.addSource('earthquakes', {
            "type": "geojson",
            "data": data
        });

        // Adding source with hexagons
        map.addSource('hexigrid', {
            "type": "geojson",
            "data": './data/hexigrid.geojson'
        });

         // Adding source with hexagons
         map.addSource('japan_border', {
            "type": "geojson",
            "data": './data/union_of_selected_boundaries_AL2-AL2.GeoJson'
        });



        // Layer with earthquakes dots
        // map.addLayer({
        //     'id': 'earthquake-circles',
        //     'type': 'circle',
        //     'source': 'earthquakes',
        //     'paint': {
        //         'circle-color': [
        //             'interpolate', ['linear'],
        //             ['get', 'mag'],
        //             2, '#FFEB3B',
        //             3, '#FFC107',
        //             4, '#FF9800',
        //             5, '#FF5722',
        //             6, '#FF5722',
        //             7, '#F44336',
        //             8, '#F44336',
        //             9, '#F44336'
        //         ],
        //         'circle-opacity': 0.8,
        //         'circle-radius': 3,
        //         // 'circle-radius': [
        //         //     'interpolate', ['linear'],
        //         //     ['get', 'mag'],
        //         //     2, 2,
        //         //     3, 4,
        //         //     4, 8,
        //         //     5, 16,
        //         //     6, 32,
        //         //     7, 64,
        //         //     8, 128,
        //         //     9, 256
        //         // ],
        //         'circle-stroke-width': 1,
        //         'circle-stroke-color': '#FFFFFF'

        //     }
        // });

        // Layer with hexagons
        // map.addLayer({
        //     "id": "hexigrid_render",
        //     "type": "fill",
        //     "source": "hexigrid",
        //     "paint": {
        //         "fill-color": "red",
        //         "fill-opacity": 0.5
        //     },
        //     "filter": ["==", "$type", "Polygon"]
        // });

        //  // Layer with border
        //  map.addLayer({
        //     "id": "border",
        //     "type": "fill",
        //     "source": "japan_border",
        //     "paint": {
        //         "fill-color": "green",
        //         "fill-opacity": 0.5
        //     },
        //     "filter": ["==", "$type", "Polygon"]
        // });




        // When a click event occurs on a feature in the places layer, 
        // open a popup at the location of the feature, with description HTML from its properties.
        map.on('click', 'earthquake-circles', function (e) {
            window.renderPopup(e);
        });

        // Change the cursor to a pointer when the mouse is over the places layer.
        map.on('mouseenter', 'earthquake-circles', function () {
            map.getCanvas().style.cursor = 'pointer';
        });

        // Change it back to a pointer when it leaves.
        map.on('mouseleave', 'earthquake-circles', function () {
            map.getCanvas().style.cursor = '';
        });

        // filterBy(1998);

        // document.getElementById('slider').addEventListener('input', function (e) {
        //     var fyear = parseInt(e.target.value, 10);
        //     filterBy(fyear);
        // });
    });
});


// Add zoom and rotation controls to the map.
map.addControl(new mapboxgl.NavigationControl());

// disable map rotation using right click + drag
map.dragRotate.disable();

// disable map rotation using touch rotation gesture
map.touchZoomRotate.disableRotation();

// full screen control in right corner
map.addControl(new mapboxgl.FullscreenControl());


// filtering function, used by slider
function filterBy(fyear) {
    var filters = ['==', 'fyear', fyear];
    map.setFilter('earthquake-circles', filters);

    // Set the label to the year 
    document.getElementById('fyear').textContent = fyear;
}
