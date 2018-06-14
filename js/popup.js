// popup.js to render popups
'use strict';

window.renderPopup = function (e) {

    var coordinates = e.features[0].geometry.coordinates.slice();
    var place = e.features[0].properties.place;
    var magnitude = e.features[0].properties.mag;
    var day1 = new Date(e.features[0].properties.time).getDate();
    var month1 = new Date(e.features[0].properties.time).getMonth();
    var year1 = new Date(e.features[0].properties.time).getFullYear();


    // Ensure that if the map is zoomed out such that multiple copies of the feature are visible, the popup appears over the copy being pointed to.
    while (Math.abs(e.lngLat.lng - coordinates[0]) > 180) {
        coordinates[0] += e.lngLat.lng > coordinates[0] ? 360 : -360;
    }

    new mapboxgl.Popup()
        .setLngLat(coordinates)
        .setHTML('<div id=\'popup\' class=\'popup\' style=\'z-index: 10;\'>' +
            '<strong>Place:</strong> ' + place + '</br>' +
            '<strong>Magnitude:</strong> ' + magnitude + '</br>' +
            '<strong>Date:</strong> ' + year1 + '-' + month1 + '-' + day1 +
            '</div>')
        .addTo(map);
}