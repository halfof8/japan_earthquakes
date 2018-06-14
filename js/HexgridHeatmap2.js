(function e(t, n, r) {
    function s(o, u) {
        if (!n[o]) {
            if (!t[o]) {
                var a = typeof require == "function" && require;
                if (!u && a) return a(o, !0);
                if (i) return i(o, !0);
                var f = new Error("Cannot find module '" + o + "'");
                throw f.code = "MODULE_NOT_FOUND", f
            }
            var l = n[o] = {
                exports: {}
            };
            t[o][0].call(l.exports, function (e) {
                var n = t[o][1][e];
                return s(n ? n : e)
            }, l, l.exports, e, t, n, r)
        }
        return n[o].exports
    }
    var i = typeof require == "function" && require;
    for (var o = 0; o < r.length; o++) s(r[o]);
    return s
})({
    1: [function (require, module, exports) {
        var rbush = require('rbush');
        var turf = {
            center: require('@turf/center'),
            hexGrid: require('@turf/hex-grid'),
            destination: require('@turf/destination'),
            distance: require('@turf/distance'),
        };
        /** 
         * Creates a hexgrid-based vector heatmap on the specified map.
         * @constructor
         * @param {Map} map - The map object that this heatmap should add itself to and track.
         * @param {string} [layername=hexgrid-heatmap] - The layer name to use for the heatmap.
         * @param {string} [addBefore] - Name of a layer to insert this heatmap underneath.
         */
        function HexgridHeatmap(map, layername, addBefore) {
            if (layername === undefined) layername = "hexgrid-heatmap";
            this.map = map;
            this.layername = layername;
            this._setupLayers(layername, addBefore);
            this._setupEvents();
            // Set up an R-tree to look for coordinates as they are stored in GeoJSON Feature objects
            this._tree = rbush(9, ['["geometry"]["coordinates"][0]', '["geometry"]["coordinates"][1]', '["geometry"]["coordinates"][0]', '["geometry"]["coordinates"][1]']);

            this._intensity = 8;
            this._spread = 0.1;
            this._minCellIntensity = 0; // Drop out cells that have less than this intensity
            this._maxPointIntensity = 20; // Don't let a single point have a greater weight than this
            this._cellDensity = 1;

            var thisthis = this;
            this._checkUpdateCompleteClosure = function (e) {
                thisthis._checkUpdateComplete(e);
            }
            this._calculatingGrid = false;
            this._recalcWhenReady = false;

            this._reduceFunction = function (data) {
                var sum = 0;
                var count = 0;
                data.forEach(function (d) {
                    if (!isNaN(d)) {
                        sum += d;
                        count += 1;
                    }
                });
                return count > 0 ? sum / count : NaN;
            };

        }

        HexgridHeatmap.prototype = {
            _setupLayers: function (layername, addBefore) {
                this.map.addLayer({
                    'id': layername,
                    'type': 'fill',
                    'source': {
                        type: 'geojson',
                        data: {
                            type: "FeatureCollection",
                            features: []
                        }
                    },
                    'paint': {
                        'fill-opacity': 1.0,
                        'fill-color': {
                            property: 'mag',
                            stops: [
                                // Short rainbow blue
                                [0, "rgba(0,185,243,0)"],
                                [50, "rgba(0,185,243,0.24)"],
                                [130, "rgba(255,223,0,0.3)"],
                                [200, "rgba(255,105,0,0.3)"],
                            ]
                        }
                    }
                }, addBefore);

                this.layer = this.map.getLayer(layername);
                this.source = this.map.getSource(layername);
            },
            _setupEvents: function () {
                var thisthis = this;
                this.map.on("moveend", function () {
                    thisthis._updateGrid();
                });
            },

            /**
             * Sets the function which reduces multiple values to a single one.
             * The default "reducer" is a mean function.
             * @param f
             */
            setReduceFunction: function (f) {
                this._reduceFunction = f;
            },

            /**
             * The propertyName each GeoJson Feature contains which is given to the reduce function.
             * Default gives all properties. Set an empty string or a null to explicitly invoke this behavior.
             * @param propertyName
             */
            setPropertyName: function (propertyName) {
                this._propertyName = propertyName;
            },


            /**
             * Set the data to visualize with this heatmap layer
             * @param {FeatureCollection} data - A GeoJSON FeatureCollection containing data to visualize with this heatmap
             * @public
             */
            setData: function (data) {
                // Re-build R-tree index
                this._tree.clear();
                this._tree.load(data.features);
            },


            /**
             * Set how widely points affect their neighbors
             * @param {number} spread - A good starting point is 0.1. Higher values will result in more blurred heatmaps, lower values will highlight individual points more strongly.
             * @public
             */
            setSpread: function (spread) {
                this._spread = spread;
            },


            /**
             * Set the intensity value for all points.
             * @param {number} intensity - Setting this too low will result in no data displayed, setting it too high will result in an oversaturated map. The default is 8 so adjust up or down from there according to the density of your data.
             * @public
             */
            setIntensity: function (intensity) {
                this._intensity = intensity;
            },


            /**
             * Set custom stops for the heatmap color schem
             * @param {array} stops - An array of `stops` in the format of the Mapbox GL Style Spec. Values should range from 0 to about 200, though you can control saturation by setting different values here.
             */
            setColorStops: function (stops) {
                this.layer.setPaintProperty("fill-color", {
                    property: "strength",
                    stops: stops
                });
            },


            /**
             * Set the hexgrid cell density
             * @param {number} density - Values less than 1 will result in a decreased cell density from the default, values greater than 1 will result in increaded density/higher resolution. Setting this value too high will result in slow performance.
             * @public
             */
            setCellDensity: function (density) {
                this._cellDensity = density;
            },


            /**
             * Manually force an update to the heatmap
             * You can call this method to manually force the heatmap to be redrawn. Use this after calling `setData()`, `setSpread()`, or `setIntensity()`
             */
            update: function () {
                this._updateGrid();
            },


            _generateGrid: function () {
                // Rebuild grid
                //var cellSize = Math.min(Math.max(1000/Math.pow(2,this.map.transform.zoom), 0.01), 0.1); // Constant screen size

                var cellSize = Math.max(500 / Math.pow(2, this.map.transform.zoom) / this._cellDensity, 0.01); // Constant screen size

                // TODO: These extents don't work when the map is rotated
                var extents = this.map.getBounds().toArray()
                extents = [extents[0][0], extents[0][1], extents[1][0], extents[1][1]];

                var hexgrid = turf.hexGrid(extents, cellSize, 'kilometers');

                var sigma = this._spread;
                var a = 1 / (sigma * Math.sqrt(2 * Math.PI));
                var amplitude = this._intensity;

                var cellsToSave = [];

                var thisthis = this;
                hexgrid.features.forEach(function (cell) {
                    var center = turf.center(cell);
                    var strength = 0;
                    var SW = turf.destination(center, sigma * 4, -135);
                    var NE = turf.destination(center, sigma * 4, 45);
                    var pois = thisthis._tree.search({
                        minX: SW.geometry.coordinates[0],
                        minY: SW.geometry.coordinates[1],
                        maxX: NE.geometry.coordinates[0],
                        maxY: NE.geometry.coordinates[1]
                    });
                    if (pois.length > 0) {
                        var values = pois.map(function (d) {
                            if (thisthis._propertyName) {
                                return d['properties'][thisthis._propertyName]
                            } else {
                                return d['properties']
                            }
                        });
                        var strength = thisthis._reduceFunction(values);
                        if (!isNaN(strength)) {
                            cell.properties.strength = strength;
                            cellsToSave.push(cell);
                        }
                    }

                });

                hexgrid.features = cellsToSave;
                return hexgrid;

            },
            _updateGrid: function () {
                if (!this._calculatingGrid) {
                    this._calculatingGrid = true;
                    var hexgrid = this._generateGrid();
                    if (hexgrid != null) {
                        var thisthis = this;
                        this.source.on("data", this._checkUpdateCompleteClosure);
                        this.source.setData(hexgrid);
                    } else {
                        this._calculatingGrid = false;
                    }
                } else {
                    this._recalcWhenReady = true;
                }
            },
            _checkUpdateComplete: function (e) {
                if (e.dataType == "source") {
                    this.source.off("data", this._checkUpdateCompleteClosure);
                    this._calculatingGrid = false;
                    if (this._recalcWhenReady) this._updateGrid();
                }
            }
        };

        module.exports = exports = HexgridHeatmap;
    }, {
        "@turf/center": 4,
        "@turf/destination": 5,
        "@turf/distance": 6,
        "@turf/hex-grid": 8,
        "rbush": 12
    }],
    2: [function (require, module, exports) {
        window.HexgridHeatmap = require('./HexgridHeatmap');
    }, {
        "./HexgridHeatmap": 1
    }],
    3: [function (require, module, exports) {
        var each = require('@turf/meta').coordEach;

        /**
         * Takes a set of features, calculates the bbox of all input features, and returns a bounding box.
         *
         * @name bbox
         * @param {(Feature|FeatureCollection)} geojson input features
         * @returns {Array<number>} bbox extent in [minX, minY, maxX, maxY] order
         * @addToMap features, bboxPolygon
         * @example
         * var pt1 = turf.point([114.175329, 22.2524])
         * var pt2 = turf.point([114.170007, 22.267969])
         * var pt3 = turf.point([114.200649, 22.274641])
         * var pt4 = turf.point([114.200649, 22.274641])
         * var pt5 = turf.point([114.186744, 22.265745])
         * var features = turf.featureCollection([pt1, pt2, pt3, pt4, pt5])
         *
         * var bbox = turf.bbox(features);
         *
         * var bboxPolygon = turf.bboxPolygon(bbox);
         *
         * //=bbox
         *
         * //=bboxPolygon
         */
        module.exports = function (geojson) {
            var bbox = [Infinity, Infinity, -Infinity, -Infinity];
            each(geojson, function (coord) {
                if (bbox[0] > coord[0]) bbox[0] = coord[0];
                if (bbox[1] > coord[1]) bbox[1] = coord[1];
                if (bbox[2] < coord[0]) bbox[2] = coord[0];
                if (bbox[3] < coord[1]) bbox[3] = coord[1];
            });
            return bbox;
        };

    }, {
        "@turf/meta": 10
    }],
    4: [function (require, module, exports) {
        var bbox = require('@turf/bbox'),
            point = require('@turf/helpers').point;

        /**
         * Takes a {@link Feature} or {@link FeatureCollection} and returns the absolute center point of all features.
         *
         * @name center
         * @param {(Feature|FeatureCollection)} layer input features
         * @return {Feature<Point>} a Point feature at the absolute center point of all input features
         * @addToMap features, centerPt
         * @example
         * var features = {
         *   "type": "FeatureCollection",
         *   "features": [
         *     {
         *       "type": "Feature",
         *       "properties": {},
         *       "geometry": {
         *         "type": "Point",
         *         "coordinates": [-97.522259, 35.4691]
         *       }
         *     }, {
         *       "type": "Feature",
         *       "properties": {},
         *       "geometry": {
         *         "type": "Point",
         *         "coordinates": [-97.502754, 35.463455]
         *       }
         *     }, {
         *       "type": "Feature",
         *       "properties": {},
         *       "geometry": {
         *         "type": "Point",
         *         "coordinates": [-97.508269, 35.463245]
         *       }
         *     }, {
         *       "type": "Feature",
         *       "properties": {},
         *       "geometry": {
         *         "type": "Point",
         *         "coordinates": [-97.516809, 35.465779]
         *       }
         *     }, {
         *       "type": "Feature",
         *       "properties": {},
         *       "geometry": {
         *         "type": "Point",
         *         "coordinates": [-97.515372, 35.467072]
         *       }
         *     }, {
         *       "type": "Feature",
         *       "properties": {},
         *       "geometry": {
         *         "type": "Point",
         *         "coordinates": [-97.509363, 35.463053]
         *       }
         *     }, {
         *       "type": "Feature",
         *       "properties": {},
         *       "geometry": {
         *         "type": "Point",
         *         "coordinates": [-97.511123, 35.466601]
         *       }
         *     }, {
         *       "type": "Feature",
         *       "properties": {},
         *       "geometry": {
         *         "type": "Point",
         *         "coordinates": [-97.518547, 35.469327]
         *       }
         *     }, {
         *       "type": "Feature",
         *       "properties": {},
         *       "geometry": {
         *         "type": "Point",
         *         "coordinates": [-97.519706, 35.469659]
         *       }
         *     }, {
         *       "type": "Feature",
         *       "properties": {},
         *       "geometry": {
         *         "type": "Point",
         *         "coordinates": [-97.517839, 35.466998]
         *       }
         *     }, {
         *       "type": "Feature",
         *       "properties": {},
         *       "geometry": {
         *         "type": "Point",
         *         "coordinates": [-97.508678, 35.464942]
         *       }
         *     }, {
         *       "type": "Feature",
         *       "properties": {},
         *       "geometry": {
         *         "type": "Point",
         *         "coordinates": [-97.514914, 35.463453]
         *       }
         *     }
         *   ]
         * };
         *
         * var centerPt = turf.center(features);
         * centerPt.properties['marker-size'] = 'large';
         * centerPt.properties['marker-color'] = '#000';
         *
         * var resultFeatures = features.features.concat(centerPt);
         * var result = {
         *   "type": "FeatureCollection",
         *   "features": resultFeatures
         * };
         *
         * //=result
         */

        module.exports = function (layer) {
            var ext = bbox(layer);
            var x = (ext[0] + ext[2]) / 2;
            var y = (ext[1] + ext[3]) / 2;
            return point([x, y]);
        };

    }, {
        "@turf/bbox": 3,
        "@turf/helpers": 7
    }],
    5: [function (require, module, exports) {
        //http://en.wikipedia.org/wiki/Haversine_formula
        //http://www.movable-type.co.uk/scripts/latlong.html
        var getCoord = require('@turf/invariant').getCoord;
        var helpers = require('@turf/helpers');
        var point = helpers.point;
        var distanceToRadians = helpers.distanceToRadians;

        /**
         * Takes a {@link Point} and calculates the location of a destination point given a distance in degrees, radians, miles, or kilometers; and bearing in degrees. This uses the [Haversine formula](http://en.wikipedia.org/wiki/Haversine_formula) to account for global curvature.
         *
         * @name destination
         * @param {Feature<Point>} from starting point
         * @param {number} distance distance from the starting point
         * @param {number} bearing ranging from -180 to 180
         * @param {string} [units=kilometers] miles, kilometers, degrees, or radians
         * @returns {Feature<Point>} destination point
         * @example
         * var point = {
         *   "type": "Feature",
         *   "properties": {
         *     "marker-color": "#0f0"
         *   },
         *   "geometry": {
         *     "type": "Point",
         *     "coordinates": [-75.343, 39.984]
         *   }
         * };
         * var distance = 50;
         * var bearing = 90;
         * var units = 'miles';
         *
         * var destination = turf.destination(point, distance, bearing, units);
         * destination.properties['marker-color'] = '#f00';
         *
         * var result = {
         *   "type": "FeatureCollection",
         *   "features": [point, destination]
         * };
         *
         * //=result
         */
        module.exports = function (from, distance, bearing, units) {
            var degrees2radians = Math.PI / 180;
            var radians2degrees = 180 / Math.PI;
            var coordinates1 = getCoord(from);
            var longitude1 = degrees2radians * coordinates1[0];
            var latitude1 = degrees2radians * coordinates1[1];
            var bearing_rad = degrees2radians * bearing;

            var radians = distanceToRadians(distance, units);

            var latitude2 = Math.asin(Math.sin(latitude1) * Math.cos(radians) +
                Math.cos(latitude1) * Math.sin(radians) * Math.cos(bearing_rad));
            var longitude2 = longitude1 + Math.atan2(Math.sin(bearing_rad) *
                Math.sin(radians) * Math.cos(latitude1),
                Math.cos(radians) - Math.sin(latitude1) * Math.sin(latitude2));

            return point([radians2degrees * longitude2, radians2degrees * latitude2]);
        };

    }, {
        "@turf/helpers": 7,
        "@turf/invariant": 9
    }],
    6: [function (require, module, exports) {
        var getCoord = require('@turf/invariant').getCoord;
        var radiansToDistance = require('@turf/helpers').radiansToDistance;
        //http://en.wikipedia.org/wiki/Haversine_formula
        //http://www.movable-type.co.uk/scripts/latlong.html

        /**
         * Calculates the distance between two {@link Point|points} in degrees, radians,
         * miles, or kilometers. This uses the
         * [Haversine formula](http://en.wikipedia.org/wiki/Haversine_formula)
         * to account for global curvature.
         *
         * @name distance
         * @param {Feature<Point>} from origin point
         * @param {Feature<Point>} to destination point
         * @param {string} [units=kilometers] can be degrees, radians, miles, or kilometers
         * @returns {number} distance between the two points
         * @example
         * var from = {
         *   "type": "Feature",
         *   "properties": {},
         *   "geometry": {
         *     "type": "Point",
         *     "coordinates": [-75.343, 39.984]
         *   }
         * };
         * var to = {
         *   "type": "Feature",
         *   "properties": {},
         *   "geometry": {
         *     "type": "Point",
         *     "coordinates": [-75.534, 39.123]
         *   }
         * };
         * var units = "miles";
         *
         * var points = {
         *   "type": "FeatureCollection",
         *   "features": [from, to]
         * };
         *
         * //=points
         *
         * var distance = turf.distance(from, to, units);
         *
         * //=distance
         */
        module.exports = function (from, to, units) {
            var degrees2radians = Math.PI / 180;
            var coordinates1 = getCoord(from);
            var coordinates2 = getCoord(to);
            var dLat = degrees2radians * (coordinates2[1] - coordinates1[1]);
            var dLon = degrees2radians * (coordinates2[0] - coordinates1[0]);
            var lat1 = degrees2radians * coordinates1[1];
            var lat2 = degrees2radians * coordinates2[1];

            var a = Math.pow(Math.sin(dLat / 2), 2) +
                Math.pow(Math.sin(dLon / 2), 2) * Math.cos(lat1) * Math.cos(lat2);

            return radiansToDistance(2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)), units);
        };

    }, {
        "@turf/helpers": 7,
        "@turf/invariant": 9
    }],
    7: [function (require, module, exports) {
        /**
         * Wraps a GeoJSON {@link Geometry} in a GeoJSON {@link Feature}.
         *
         * @name feature
         * @param {Geometry} geometry input geometry
         * @param {Object} properties properties
         * @returns {FeatureCollection} a FeatureCollection of input features
         * @example
         * var geometry = {
         *      "type": "Point",
         *      "coordinates": [
         *        67.5,
         *        32.84267363195431
         *      ]
         *    }
         *
         * var feature = turf.feature(geometry);
         *
         * //=feature
         */
        function feature(geometry, properties) {
            if (!geometry) throw new Error('No geometry passed');

            return {
                type: 'Feature',
                properties: properties || {},
                geometry: geometry
            };
        }
        module.exports.feature = feature;

        /**
         * Takes coordinates and properties (optional) and returns a new {@link Point} feature.
         *
         * @name point
         * @param {Array<number>} coordinates longitude, latitude position (each in decimal degrees)
         * @param {Object=} properties an Object that is used as the {@link Feature}'s
         * properties
         * @returns {Feature<Point>} a Point feature
         * @example
         * var pt1 = turf.point([-75.343, 39.984]);
         *
         * //=pt1
         */
        module.exports.point = function (coordinates, properties) {
            if (!coordinates) throw new Error('No coordinates passed');
            if (coordinates.length === undefined) throw new Error('Coordinates must be an array');
            if (coordinates.length < 2) throw new Error('Coordinates must be at least 2 numbers long');
            if (typeof coordinates[0] !== 'number' || typeof coordinates[1] !== 'number') throw new Error('Coordinates must numbers');

            return feature({
                type: 'Point',
                coordinates: coordinates
            }, properties);
        };

        /**
         * Takes an array of LinearRings and optionally an {@link Object} with properties and returns a {@link Polygon} feature.
         *
         * @name polygon
         * @param {Array<Array<Array<number>>>} coordinates an array of LinearRings
         * @param {Object=} properties a properties object
         * @returns {Feature<Polygon>} a Polygon feature
         * @throws {Error} throw an error if a LinearRing of the polygon has too few positions
         * or if a LinearRing of the Polygon does not have matching Positions at the
         * beginning & end.
         * @example
         * var polygon = turf.polygon([[
         *  [-2.275543, 53.464547],
         *  [-2.275543, 53.489271],
         *  [-2.215118, 53.489271],
         *  [-2.215118, 53.464547],
         *  [-2.275543, 53.464547]
         * ]], { name: 'poly1', population: 400});
         *
         * //=polygon
         */
        module.exports.polygon = function (coordinates, properties) {
            if (!coordinates) throw new Error('No coordinates passed');

            for (var i = 0; i < coordinates.length; i++) {
                var ring = coordinates[i];
                if (ring.length < 4) {
                    throw new Error('Each LinearRing of a Polygon must have 4 or more Positions.');
                }
                for (var j = 0; j < ring[ring.length - 1].length; j++) {
                    if (ring[ring.length - 1][j] !== ring[0][j]) {
                        throw new Error('First and last Position are not equivalent.');
                    }
                }
            }

            return feature({
                type: 'Polygon',
                coordinates: coordinates
            }, properties);
        };

        /**
         * Creates a {@link LineString} based on a
         * coordinate array. Properties can be added optionally.
         *
         * @name lineString
         * @param {Array<Array<number>>} coordinates an array of Positions
         * @param {Object=} properties an Object of key-value pairs to add as properties
         * @returns {Feature<LineString>} a LineString feature
         * @throws {Error} if no coordinates are passed
         * @example
         * var linestring1 = turf.lineString([
         *   [-21.964416, 64.148203],
         *   [-21.956176, 64.141316],
         *   [-21.93901, 64.135924],
         *   [-21.927337, 64.136673]
         * ]);
         * var linestring2 = turf.lineString([
         *   [-21.929054, 64.127985],
         *   [-21.912918, 64.134726],
         *   [-21.916007, 64.141016],
         *   [-21.930084, 64.14446]
         * ], {name: 'line 1', distance: 145});
         *
         * //=linestring1
         *
         * //=linestring2
         */
        module.exports.lineString = function (coordinates, properties) {
            if (!coordinates) throw new Error('No coordinates passed');

            return feature({
                type: 'LineString',
                coordinates: coordinates
            }, properties);
        };

        /**
         * Takes one or more {@link Feature|Features} and creates a {@link FeatureCollection}.
         *
         * @name featureCollection
         * @param {Feature[]} features input features
         * @returns {FeatureCollection} a FeatureCollection of input features
         * @example
         * var features = [
         *  turf.point([-75.343, 39.984], {name: 'Location A'}),
         *  turf.point([-75.833, 39.284], {name: 'Location B'}),
         *  turf.point([-75.534, 39.123], {name: 'Location C'})
         * ];
         *
         * var fc = turf.featureCollection(features);
         *
         * //=fc
         */
        module.exports.featureCollection = function (features) {
            if (!features) throw new Error('No features passed');

            return {
                type: 'FeatureCollection',
                features: features
            };
        };

        /**
         * Creates a {@link Feature<MultiLineString>} based on a
         * coordinate array. Properties can be added optionally.
         *
         * @name multiLineString
         * @param {Array<Array<Array<number>>>} coordinates an array of LineStrings
         * @param {Object=} properties an Object of key-value pairs to add as properties
         * @returns {Feature<MultiLineString>} a MultiLineString feature
         * @throws {Error} if no coordinates are passed
         * @example
         * var multiLine = turf.multiLineString([[[0,0],[10,10]]]);
         *
         * //=multiLine
         *
         */
        module.exports.multiLineString = function (coordinates, properties) {
            if (!coordinates) throw new Error('No coordinates passed');

            return feature({
                type: 'MultiLineString',
                coordinates: coordinates
            }, properties);
        };

        /**
         * Creates a {@link Feature<MultiPoint>} based on a
         * coordinate array. Properties can be added optionally.
         *
         * @name multiPoint
         * @param {Array<Array<number>>} coordinates an array of Positions
         * @param {Object=} properties an Object of key-value pairs to add as properties
         * @returns {Feature<MultiPoint>} a MultiPoint feature
         * @throws {Error} if no coordinates are passed
         * @example
         * var multiPt = turf.multiPoint([[0,0],[10,10]]);
         *
         * //=multiPt
         *
         */
        module.exports.multiPoint = function (coordinates, properties) {
            if (!coordinates) throw new Error('No coordinates passed');

            return feature({
                type: 'MultiPoint',
                coordinates: coordinates
            }, properties);
        };


        /**
         * Creates a {@link Feature<MultiPolygon>} based on a
         * coordinate array. Properties can be added optionally.
         *
         * @name multiPolygon
         * @param {Array<Array<Array<Array<number>>>>} coordinates an array of Polygons
         * @param {Object=} properties an Object of key-value pairs to add as properties
         * @returns {Feature<MultiPolygon>} a multipolygon feature
         * @throws {Error} if no coordinates are passed
         * @example
         * var multiPoly = turf.multiPolygon([[[[0,0],[0,10],[10,10],[10,0],[0,0]]]]);
         *
         * //=multiPoly
         *
         */
        module.exports.multiPolygon = function (coordinates, properties) {
            if (!coordinates) throw new Error('No coordinates passed');

            return feature({
                type: 'MultiPolygon',
                coordinates: coordinates
            }, properties);
        };

        /**
         * Creates a {@link Feature<GeometryCollection>} based on a
         * coordinate array. Properties can be added optionally.
         *
         * @name geometryCollection
         * @param {Array<{Geometry}>} geometries an array of GeoJSON Geometries
         * @param {Object=} properties an Object of key-value pairs to add as properties
         * @returns {Feature<GeometryCollection>} a GeoJSON GeometryCollection Feature
         * @example
         * var pt = {
         *     "type": "Point",
         *       "coordinates": [100, 0]
         *     };
         * var line = {
         *     "type": "LineString",
         *     "coordinates": [ [101, 0], [102, 1] ]
         *   };
         * var collection = turf.geometryCollection([pt, line]);
         *
         * //=collection
         */
        module.exports.geometryCollection = function (geometries, properties) {
            if (!geometries) throw new Error('No geometries passed');

            return feature({
                type: 'GeometryCollection',
                geometries: geometries
            }, properties);
        };

        var factors = {
            miles: 3960,
            nauticalmiles: 3441.145,
            degrees: 57.2957795,
            radians: 1,
            inches: 250905600,
            yards: 6969600,
            meters: 6373000,
            metres: 6373000,
            kilometers: 6373,
            kilometres: 6373,
            feet: 20908792.65
        };

        /*
         * Convert a distance measurement from radians to a more friendly unit.
         *
         * @name radiansToDistance
         * @param {number} distance in radians across the sphere
         * @param {string} [units=kilometers] can be degrees, radians, miles, or kilometers
         * inches, yards, metres, meters, kilometres, kilometers.
         * @returns {number} distance
         */
        module.exports.radiansToDistance = function (radians, units) {
            var factor = factors[units || 'kilometers'];
            if (factor === undefined) throw new Error('Invalid unit');

            return radians * factor;
        };

        /*
         * Convert a distance measurement from a real-world unit into radians
         *
         * @name distanceToRadians
         * @param {number} distance in real units
         * @param {string} [units=kilometers] can be degrees, radians, miles, or kilometers
         * inches, yards, metres, meters, kilometres, kilometers.
         * @returns {number} radians
         */
        module.exports.distanceToRadians = function (distance, units) {
            var factor = factors[units || 'kilometers'];
            if (factor === undefined) throw new Error('Invalid unit');

            return distance / factor;
        };

        /*
         * Convert a distance measurement from a real-world unit into degrees
         *
         * @name distanceToRadians
         * @param {number} distance in real units
         * @param {string} [units=kilometers] can be degrees, radians, miles, or kilometers
         * inches, yards, metres, meters, kilometres, kilometers.
         * @returns {number} degrees
         */
        module.exports.distanceToDegrees = function (distance, units) {
            var factor = factors[units || 'kilometers'];
            if (factor === undefined) throw new Error('Invalid unit');

            return (distance / factor) * 57.2958;
        };

    }, {}],
    8: [function (require, module, exports) {
        var point = require('@turf/helpers').point;
        var polygon = require('@turf/helpers').polygon;
        var distance = require('@turf/distance');
        var featurecollection = require('@turf/helpers').featureCollection;

        //Precompute cosines and sines of angles used in hexagon creation
        // for performance gain
        var cosines = [];
        var sines = [];
        for (var i = 0; i < 6; i++) {
            var angle = 2 * Math.PI / 6 * i;
            cosines.push(Math.cos(angle));
            sines.push(Math.sin(angle));
        }

        /**
         * Takes a bounding box and a cell size in degrees and returns a {@link FeatureCollection} of flat-topped
         * hexagons ({@link Polygon} features) aligned in an "odd-q" vertical grid as
         * described in [Hexagonal Grids](http://www.redblobgames.com/grids/hexagons/).
         *
         * @name hexGrid
         * @param {Array<number>} bbox extent in [minX, minY, maxX, maxY] order
         * @param {number} cellSize dimension of cell in specified units
         * @param {string} [units=kilometers] used in calculating cellSize, can be degrees, radians, miles, or kilometers
         * @param {boolean} [triangles=false] whether to return as triangles instead of hexagons
         * @returns {FeatureCollection<Polygon>} a hexagonal grid
         * @example
         * var bbox = [-96,31,-84,40];
         * var cellSize = 50;
         * var units = 'miles';
         *
         * var hexgrid = turf.hexGrid(bbox, cellSize, units);
         *
         * //=hexgrid
         */
        module.exports = function hexGrid(bbox, cellSize, units, triangles) {
            var xFraction = cellSize / (distance(point([bbox[0], bbox[1]]), point([bbox[2], bbox[1]]), units));
            var cellWidth = xFraction * (bbox[2] - bbox[0]);
            var yFraction = cellSize / (distance(point([bbox[0], bbox[1]]), point([bbox[0], bbox[3]]), units));
            var cellHeight = yFraction * (bbox[3] - bbox[1]);
            var radius = cellWidth / 2;

            var hex_width = radius * 2;
            var hex_height = Math.sqrt(3) / 2 * cellHeight;

            var box_width = bbox[2] - bbox[0];
            var box_height = bbox[3] - bbox[1];

            var x_interval = 3 / 4 * hex_width;
            var y_interval = hex_height;

            var x_span = box_width / (hex_width - radius / 2);
            var x_count = Math.ceil(x_span);
            if (Math.round(x_span) === x_count) {
                x_count++;
            }

            var x_adjust = ((x_count * x_interval - radius / 2) - box_width) / 2 - radius / 2;

            var y_count = Math.ceil(box_height / hex_height);

            var y_adjust = (box_height - y_count * hex_height) / 2;

            var hasOffsetY = y_count * hex_height - box_height > hex_height / 2;
            if (hasOffsetY) {
                y_adjust -= hex_height / 4;
            }

            var fc = featurecollection([]);
            for (var x = 0; x < x_count; x++) {
                for (var y = 0; y <= y_count; y++) {

                    var isOdd = x % 2 === 1;
                    if (y === 0 && isOdd) {
                        continue;
                    }

                    if (y === 0 && hasOffsetY) {
                        continue;
                    }

                    var center_x = x * x_interval + bbox[0] - x_adjust;
                    var center_y = y * y_interval + bbox[1] + y_adjust;

                    if (isOdd) {
                        center_y -= hex_height / 2;
                    }
                    if (triangles) {
                        fc.features.push.apply(fc.features, hexTriangles([center_x, center_y], cellWidth / 2, cellHeight / 2));
                    } else {
                        fc.features.push(hexagon([center_x, center_y], cellWidth / 2, cellHeight / 2));
                    }
                }
            }

            return fc;
        };

        //Center should be [x, y]
        function hexagon(center, rx, ry) {
            var vertices = [];
            for (var i = 0; i < 6; i++) {
                var x = center[0] + rx * cosines[i];
                var y = center[1] + ry * sines[i];
                vertices.push([x, y]);
            }
            //first and last vertex must be the same
            vertices.push(vertices[0]);
            return polygon([vertices]);
        }

        //Center should be [x, y]
        function hexTriangles(center, rx, ry) {
            var triangles = [];
            for (var i = 0; i < 6; i++) {
                var vertices = [];
                vertices.push(center);
                vertices.push([
                    center[0] + rx * cosines[i],
                    center[1] + ry * sines[i]
                ]);
                vertices.push([
                    center[0] + rx * cosines[(i + 1) % 6],
                    center[1] + ry * sines[(i + 1) % 6]
                ]);
                vertices.push(center);
                triangles.push(polygon([vertices]));
            }
            return triangles;
        }

    }, {
        "@turf/distance": 6,
        "@turf/helpers": 7
    }],
    9: [function (require, module, exports) {
        /**
         * Unwrap a coordinate from a Point Feature, Geometry or a single coordinate.
         *
         * @param {Array<any>|Geometry|Feature<Point>} obj any value
         * @returns {Array<number>} coordinates
         */
        function getCoord(obj) {
            if (!obj) throw new Error('No obj passed');

            var coordinates = getCoords(obj);

            // getCoord() must contain at least two numbers (Point)
            if (coordinates.length > 1 &&
                typeof coordinates[0] === 'number' &&
                typeof coordinates[1] === 'number') {
                return coordinates;
            } else {
                throw new Error('Coordinate is not a valid Point');
            }
        }

        /**
         * Unwrap coordinates from a Feature, Geometry Object or an Array of numbers
         *
         * @param {Array<any>|Geometry|Feature<any>} obj any value
         * @returns {Array<any>} coordinates
         */
        function getCoords(obj) {
            if (!obj) throw new Error('No obj passed');
            var coordinates;

            // Array of numbers
            if (obj.length) {
                coordinates = obj;

                // Geometry Object
            } else if (obj.coordinates) {
                coordinates = obj.coordinates;

                // Feature
            } else if (obj.geometry && obj.geometry.coordinates) {
                coordinates = obj.geometry.coordinates;
            }
            // Checks if coordinates contains a number
            if (coordinates) {
                containsNumber(coordinates);
                return coordinates;
            }
            throw new Error('No valid coordinates');
        }

        /**
         * Checks if coordinates contains a number
         *
         * @private
         * @param {Array<any>} coordinates GeoJSON Coordinates
         * @returns {boolean} true if Array contains a number
         */
        function containsNumber(coordinates) {
            if (coordinates.length > 1 &&
                typeof coordinates[0] === 'number' &&
                typeof coordinates[1] === 'number') {
                return true;
            }
            if (coordinates[0].length) {
                return containsNumber(coordinates[0]);
            }
            throw new Error('coordinates must only contain numbers');
        }

        /**
         * Enforce expectations about types of GeoJSON objects for Turf.
         *
         * @alias geojsonType
         * @param {GeoJSON} value any GeoJSON object
         * @param {string} type expected GeoJSON type
         * @param {string} name name of calling function
         * @throws {Error} if value is not the expected type.
         */
        function geojsonType(value, type, name) {
            if (!type || !name) throw new Error('type and name required');

            if (!value || value.type !== type) {
                throw new Error('Invalid input to ' + name + ': must be a ' + type + ', given ' + value.type);
            }
        }

        /**
         * Enforce expectations about types of {@link Feature} inputs for Turf.
         * Internally this uses {@link geojsonType} to judge geometry types.
         *
         * @alias featureOf
         * @param {Feature} feature a feature with an expected geometry type
         * @param {string} type expected GeoJSON type
         * @param {string} name name of calling function
         * @throws {Error} error if value is not the expected type.
         */
        function featureOf(feature, type, name) {
            if (!feature) throw new Error('No feature passed');
            if (!name) throw new Error('.featureOf() requires a name');
            if (!feature || feature.type !== 'Feature' || !feature.geometry) {
                throw new Error('Invalid input to ' + name + ', Feature with geometry required');
            }
            if (!feature.geometry || feature.geometry.type !== type) {
                throw new Error('Invalid input to ' + name + ': must be a ' + type + ', given ' + feature.geometry.type);
            }
        }

        /**
         * Enforce expectations about types of {@link FeatureCollection} inputs for Turf.
         * Internally this uses {@link geojsonType} to judge geometry types.
         *
         * @alias collectionOf
         * @param {FeatureCollection} featureCollection a FeatureCollection for which features will be judged
         * @param {string} type expected GeoJSON type
         * @param {string} name name of calling function
         * @throws {Error} if value is not the expected type.
         */
        function collectionOf(featureCollection, type, name) {
            if (!featureCollection) throw new Error('No featureCollection passed');
            if (!name) throw new Error('.collectionOf() requires a name');
            if (!featureCollection || featureCollection.type !== 'FeatureCollection') {
                throw new Error('Invalid input to ' + name + ', FeatureCollection required');
            }
            for (var i = 0; i < featureCollection.features.length; i++) {
                var feature = featureCollection.features[i];
                if (!feature || feature.type !== 'Feature' || !feature.geometry) {
                    throw new Error('Invalid input to ' + name + ', Feature with geometry required');
                }
                if (!feature.geometry || feature.geometry.type !== type) {
                    throw new Error('Invalid input to ' + name + ': must be a ' + type + ', given ' + feature.geometry.type);
                }
            }
        }

        module.exports.geojsonType = geojsonType;
        module.exports.collectionOf = collectionOf;
        module.exports.featureOf = featureOf;
        module.exports.getCoord = getCoord;
        module.exports.getCoords = getCoords;

    }, {}],
    10: [function (require, module, exports) {
        /**
         * Callback for coordEach
         *
         * @private
         * @callback coordEachCallback
         * @param {[number, number]} currentCoords The current coordinates being processed.
         * @param {number} currentIndex The index of the current element being processed in the
         * array.Starts at index 0, if an initialValue is provided, and at index 1 otherwise.
         */

        /**
         * Iterate over coordinates in any GeoJSON object, similar to Array.forEach()
         *
         * @name coordEach
         * @param {Object} layer any GeoJSON object
         * @param {Function} callback a method that takes (currentCoords, currentIndex)
         * @param {boolean} [excludeWrapCoord=false] whether or not to include
         * the final coordinate of LinearRings that wraps the ring in its iteration.
         * @example
         * var features = {
         *   "type": "FeatureCollection",
         *   "features": [
         *     {
         *       "type": "Feature",
         *       "properties": {},
         *       "geometry": {
         *         "type": "Point",
         *         "coordinates": [26, 37]
         *       }
         *     },
         *     {
         *       "type": "Feature",
         *       "properties": {},
         *       "geometry": {
         *         "type": "Point",
         *         "coordinates": [36, 53]
         *       }
         *     }
         *   ]
         * };
         * turf.coordEach(features, function (currentCoords, currentIndex) {
         *   //=currentCoords
         *   //=currentIndex
         * });
         */
        function coordEach(layer, callback, excludeWrapCoord) {
            var i, j, k, g, l, geometry, stopG, coords,
                geometryMaybeCollection,
                wrapShrink = 0,
                currentIndex = 0,
                isGeometryCollection,
                isFeatureCollection = layer.type === 'FeatureCollection',
                isFeature = layer.type === 'Feature',
                stop = isFeatureCollection ? layer.features.length : 1;

            // This logic may look a little weird. The reason why it is that way
            // is because it's trying to be fast. GeoJSON supports multiple kinds
            // of objects at its root: FeatureCollection, Features, Geometries.
            // This function has the responsibility of handling all of them, and that
            // means that some of the `for` loops you see below actually just don't apply
            // to certain inputs. For instance, if you give this just a
            // Point geometry, then both loops are short-circuited and all we do
            // is gradually rename the input until it's called 'geometry'.
            //
            // This also aims to allocate as few resources as possible: just a
            // few numbers and booleans, rather than any temporary arrays as would
            // be required with the normalization approach.
            for (i = 0; i < stop; i++) {

                geometryMaybeCollection = (isFeatureCollection ? layer.features[i].geometry :
                    (isFeature ? layer.geometry : layer));
                isGeometryCollection = geometryMaybeCollection.type === 'GeometryCollection';
                stopG = isGeometryCollection ? geometryMaybeCollection.geometries.length : 1;

                for (g = 0; g < stopG; g++) {
                    geometry = isGeometryCollection ?
                        geometryMaybeCollection.geometries[g] : geometryMaybeCollection;
                    coords = geometry.coordinates;

                    wrapShrink = (excludeWrapCoord &&
                            (geometry.type === 'Polygon' || geometry.type === 'MultiPolygon')) ?
                        1 : 0;

                    if (geometry.type === 'Point') {
                        callback(coords, currentIndex);
                        currentIndex++;
                    } else if (geometry.type === 'LineString' || geometry.type === 'MultiPoint') {
                        for (j = 0; j < coords.length; j++) {
                            callback(coords[j], currentIndex);
                            currentIndex++;
                        }
                    } else if (geometry.type === 'Polygon' || geometry.type === 'MultiLineString') {
                        for (j = 0; j < coords.length; j++)
                            for (k = 0; k < coords[j].length - wrapShrink; k++) {
                                callback(coords[j][k], currentIndex);
                                currentIndex++;
                            }
                    } else if (geometry.type === 'MultiPolygon') {
                        for (j = 0; j < coords.length; j++)
                            for (k = 0; k < coords[j].length; k++)
                                for (l = 0; l < coords[j][k].length - wrapShrink; l++) {
                                    callback(coords[j][k][l], currentIndex);
                                    currentIndex++;
                                }
                    } else if (geometry.type === 'GeometryCollection') {
                        for (j = 0; j < geometry.geometries.length; j++)
                            coordEach(geometry.geometries[j], callback, excludeWrapCoord);
                    } else {
                        throw new Error('Unknown Geometry Type');
                    }
                }
            }
        }
        module.exports.coordEach = coordEach;

        /**
         * Callback for coordReduce
         *
         * The first time the callback function is called, the values provided as arguments depend
         * on whether the reduce method has an initialValue argument.
         *
         * If an initialValue is provided to the reduce method:
         *  - The previousValue argument is initialValue.
         *  - The currentValue argument is the value of the first element present in the array.
         *
         * If an initialValue is not provided:
         *  - The previousValue argument is the value of the first element present in the array.
         *  - The currentValue argument is the value of the second element present in the array.
         *
         * @private
         * @callback coordReduceCallback
         * @param {*} previousValue The accumulated value previously returned in the last invocation
         * of the callback, or initialValue, if supplied.
         * @param {[number, number]} currentCoords The current coordinate being processed.
         * @param {number} currentIndex The index of the current element being processed in the
         * array.Starts at index 0, if an initialValue is provided, and at index 1 otherwise.
         */

        /**
         * Reduce coordinates in any GeoJSON object, similar to Array.reduce()
         *
         * @name coordReduce
         * @param {Object} layer any GeoJSON object
         * @param {Function} callback a method that takes (previousValue, currentCoords, currentIndex)
         * @param {*} [initialValue] Value to use as the first argument to the first call of the callback.
         * @param {boolean} [excludeWrapCoord=false] whether or not to include
         * the final coordinate of LinearRings that wraps the ring in its iteration.
         * @returns {*} The value that results from the reduction.
         * @example
         * var features = {
         *   "type": "FeatureCollection",
         *   "features": [
         *     {
         *       "type": "Feature",
         *       "properties": {},
         *       "geometry": {
         *         "type": "Point",
         *         "coordinates": [26, 37]
         *       }
         *     },
         *     {
         *       "type": "Feature",
         *       "properties": {},
         *       "geometry": {
         *         "type": "Point",
         *         "coordinates": [36, 53]
         *       }
         *     }
         *   ]
         * };
         * turf.coordReduce(features, function (previousValue, currentCoords, currentIndex) {
         *   //=previousValue
         *   //=currentCoords
         *   //=currentIndex
         *   return currentCoords;
         * });
         */
        function coordReduce(layer, callback, initialValue, excludeWrapCoord) {
            var previousValue = initialValue;
            coordEach(layer, function (currentCoords, currentIndex) {
                if (currentIndex === 0 && initialValue === undefined) {
                    previousValue = currentCoords;
                } else {
                    previousValue = callback(previousValue, currentCoords, currentIndex);
                }
            }, excludeWrapCoord);
            return previousValue;
        }
        module.exports.coordReduce = coordReduce;

        /**
         * Callback for propEach
         *
         * @private
         * @callback propEachCallback
         * @param {*} currentProperties The current properties being processed.
         * @param {number} currentIndex The index of the current element being processed in the
         * array.Starts at index 0, if an initialValue is provided, and at index 1 otherwise.
         */

        /**
         * Iterate over properties in any GeoJSON object, similar to Array.forEach()
         *
         * @name propEach
         * @param {Object} layer any GeoJSON object
         * @param {Function} callback a method that takes (currentProperties, currentIndex)
         * @example
         * var features = {
         *   "type": "FeatureCollection",
         *   "features": [
         *     {
         *       "type": "Feature",
         *       "properties": {"foo": "bar"},
         *       "geometry": {
         *         "type": "Point",
         *         "coordinates": [26, 37]
         *       }
         *     },
         *     {
         *       "type": "Feature",
         *       "properties": {"hello": "world"},
         *       "geometry": {
         *         "type": "Point",
         *         "coordinates": [36, 53]
         *       }
         *     }
         *   ]
         * };
         * turf.propEach(features, function (currentProperties, currentIndex) {
         *   //=currentProperties
         *   //=currentIndex
         * });
         */
        function propEach(layer, callback) {
            var i;
            switch (layer.type) {
                case 'FeatureCollection':
                    for (i = 0; i < layer.features.length; i++) {
                        callback(layer.features[i].properties, i);
                    }
                    break;
                case 'Feature':
                    callback(layer.properties, 0);
                    break;
            }
        }
        module.exports.propEach = propEach;


        /**
         * Callback for propReduce
         *
         * The first time the callback function is called, the values provided as arguments depend
         * on whether the reduce method has an initialValue argument.
         *
         * If an initialValue is provided to the reduce method:
         *  - The previousValue argument is initialValue.
         *  - The currentValue argument is the value of the first element present in the array.
         *
         * If an initialValue is not provided:
         *  - The previousValue argument is the value of the first element present in the array.
         *  - The currentValue argument is the value of the second element present in the array.
         *
         * @private
         * @callback propReduceCallback
         * @param {*} previousValue The accumulated value previously returned in the last invocation
         * of the callback, or initialValue, if supplied.
         * @param {*} currentProperties The current properties being processed.
         * @param {number} currentIndex The index of the current element being processed in the
         * array.Starts at index 0, if an initialValue is provided, and at index 1 otherwise.
         */

        /**
         * Reduce properties in any GeoJSON object into a single value,
         * similar to how Array.reduce works. However, in this case we lazily run
         * the reduction, so an array of all properties is unnecessary.
         *
         * @name propReduce
         * @param {Object} layer any GeoJSON object
         * @param {Function} callback a method that takes (previousValue, currentProperties, currentIndex)
         * @param {*} [initialValue] Value to use as the first argument to the first call of the callback.
         * @returns {*} The value that results from the reduction.
         * @example
         * var features = {
         *   "type": "FeatureCollection",
         *   "features": [
         *     {
         *       "type": "Feature",
         *       "properties": {"foo": "bar"},
         *       "geometry": {
         *         "type": "Point",
         *         "coordinates": [26, 37]
         *       }
         *     },
         *     {
         *       "type": "Feature",
         *       "properties": {"hello": "world"},
         *       "geometry": {
         *         "type": "Point",
         *         "coordinates": [36, 53]
         *       }
         *     }
         *   ]
         * };
         * turf.propReduce(features, function (previousValue, currentProperties, currentIndex) {
         *   //=previousValue
         *   //=currentProperties
         *   //=currentIndex
         *   return currentProperties
         * });
         */
        function propReduce(layer, callback, initialValue) {
            var previousValue = initialValue;
            propEach(layer, function (currentProperties, currentIndex) {
                if (currentIndex === 0 && initialValue === undefined) {
                    previousValue = currentProperties;
                } else {
                    previousValue = callback(previousValue, currentProperties, currentIndex);
                }
            });
            return previousValue;
        }
        module.exports.propReduce = propReduce;

        /**
         * Callback for featureEach
         *
         * @private
         * @callback featureEachCallback
         * @param {Feature<any>} currentFeature The current feature being processed.
         * @param {number} currentIndex The index of the current element being processed in the
         * array.Starts at index 0, if an initialValue is provided, and at index 1 otherwise.
         */

        /**
         * Iterate over features in any GeoJSON object, similar to
         * Array.forEach.
         *
         * @name featureEach
         * @param {Object} layer any GeoJSON object
         * @param {Function} callback a method that takes (currentFeature, currentIndex)
         * @example
         * var features = {
         *   "type": "FeatureCollection",
         *   "features": [
         *     {
         *       "type": "Feature",
         *       "properties": {},
         *       "geometry": {
         *         "type": "Point",
         *         "coordinates": [26, 37]
         *       }
         *     },
         *     {
         *       "type": "Feature",
         *       "properties": {},
         *       "geometry": {
         *         "type": "Point",
         *         "coordinates": [36, 53]
         *       }
         *     }
         *   ]
         * };
         * turf.featureEach(features, function (currentFeature, currentIndex) {
         *   //=currentFeature
         *   //=currentIndex
         * });
         */
        function featureEach(layer, callback) {
            if (layer.type === 'Feature') {
                callback(layer, 0);
            } else if (layer.type === 'FeatureCollection') {
                for (var i = 0; i < layer.features.length; i++) {
                    callback(layer.features[i], i);
                }
            }
        }
        module.exports.featureEach = featureEach;

        /**
         * Callback for featureReduce
         *
         * The first time the callback function is called, the values provided as arguments depend
         * on whether the reduce method has an initialValue argument.
         *
         * If an initialValue is provided to the reduce method:
         *  - The previousValue argument is initialValue.
         *  - The currentValue argument is the value of the first element present in the array.
         *
         * If an initialValue is not provided:
         *  - The previousValue argument is the value of the first element present in the array.
         *  - The currentValue argument is the value of the second element present in the array.
         *
         * @private
         * @callback featureReduceCallback
         * @param {*} previousValue The accumulated value previously returned in the last invocation
         * of the callback, or initialValue, if supplied.
         * @param {Feature<any>} currentFeature The current Feature being processed.
         * @param {number} currentIndex The index of the current element being processed in the
         * array.Starts at index 0, if an initialValue is provided, and at index 1 otherwise.
         */

        /**
         * Reduce features in any GeoJSON object, similar to Array.reduce().
         *
         * @name featureReduce
         * @param {Object} layer any GeoJSON object
         * @param {Function} callback a method that takes (previousValue, currentFeature, currentIndex)
         * @param {*} [initialValue] Value to use as the first argument to the first call of the callback.
         * @returns {*} The value that results from the reduction.
         * @example
         * var features = {
         *   "type": "FeatureCollection",
         *   "features": [
         *     {
         *       "type": "Feature",
         *       "properties": {"foo": "bar"},
         *       "geometry": {
         *         "type": "Point",
         *         "coordinates": [26, 37]
         *       }
         *     },
         *     {
         *       "type": "Feature",
         *       "properties": {"hello": "world"},
         *       "geometry": {
         *         "type": "Point",
         *         "coordinates": [36, 53]
         *       }
         *     }
         *   ]
         * };
         * turf.featureReduce(features, function (previousValue, currentFeature, currentIndex) {
         *   //=previousValue
         *   //=currentFeature
         *   //=currentIndex
         *   return currentFeature
         * });
         */
        function featureReduce(layer, callback, initialValue) {
            var previousValue = initialValue;
            featureEach(layer, function (currentFeature, currentIndex) {
                if (currentIndex === 0 && initialValue === undefined) {
                    previousValue = currentFeature;
                } else {
                    previousValue = callback(previousValue, currentFeature, currentIndex);
                }
            });
            return previousValue;
        }
        module.exports.featureReduce = featureReduce;

        /**
         * Get all coordinates from any GeoJSON object.
         *
         * @name coordAll
         * @param {Object} layer any GeoJSON object
         * @returns {Array<Array<number>>} coordinate position array
         * @example
         * var features = {
         *   "type": "FeatureCollection",
         *   "features": [
         *     {
         *       "type": "Feature",
         *       "properties": {},
         *       "geometry": {
         *         "type": "Point",
         *         "coordinates": [26, 37]
         *       }
         *     },
         *     {
         *       "type": "Feature",
         *       "properties": {},
         *       "geometry": {
         *         "type": "Point",
         *         "coordinates": [36, 53]
         *       }
         *     }
         *   ]
         * };
         * var coords = turf.coordAll(features);
         * //=coords
         */
        function coordAll(layer) {
            var coords = [];
            coordEach(layer, function (coord) {
                coords.push(coord);
            });
            return coords;
        }
        module.exports.coordAll = coordAll;

        /**
         * Iterate over each geometry in any GeoJSON object, similar to Array.forEach()
         *
         * @name geomEach
         * @param {Object} layer any GeoJSON object
         * @param {Function} callback a method that takes (currentGeometry, currentIndex)
         * @example
         * var features = {
         *   "type": "FeatureCollection",
         *   "features": [
         *     {
         *       "type": "Feature",
         *       "properties": {},
         *       "geometry": {
         *         "type": "Point",
         *         "coordinates": [26, 37]
         *       }
         *     },
         *     {
         *       "type": "Feature",
         *       "properties": {},
         *       "geometry": {
         *         "type": "Point",
         *         "coordinates": [36, 53]
         *       }
         *     }
         *   ]
         * };
         * turf.geomEach(features, function (currentGeometry, currentIndex) {
         *   //=currentGeometry
         *   //=currentIndex
         * });
         */
        function geomEach(layer, callback) {
            var i, j, g, geometry, stopG,
                geometryMaybeCollection,
                isGeometryCollection,
                currentIndex = 0,
                isFeatureCollection = layer.type === 'FeatureCollection',
                isFeature = layer.type === 'Feature',
                stop = isFeatureCollection ? layer.features.length : 1;

            // This logic may look a little weird. The reason why it is that way
            // is because it's trying to be fast. GeoJSON supports multiple kinds
            // of objects at its root: FeatureCollection, Features, Geometries.
            // This function has the responsibility of handling all of them, and that
            // means that some of the `for` loops you see below actually just don't apply
            // to certain inputs. For instance, if you give this just a
            // Point geometry, then both loops are short-circuited and all we do
            // is gradually rename the input until it's called 'geometry'.
            //
            // This also aims to allocate as few resources as possible: just a
            // few numbers and booleans, rather than any temporary arrays as would
            // be required with the normalization approach.
            for (i = 0; i < stop; i++) {

                geometryMaybeCollection = (isFeatureCollection ? layer.features[i].geometry :
                    (isFeature ? layer.geometry : layer));
                isGeometryCollection = geometryMaybeCollection.type === 'GeometryCollection';
                stopG = isGeometryCollection ? geometryMaybeCollection.geometries.length : 1;

                for (g = 0; g < stopG; g++) {
                    geometry = isGeometryCollection ?
                        geometryMaybeCollection.geometries[g] : geometryMaybeCollection;

                    if (geometry.type === 'Point' ||
                        geometry.type === 'LineString' ||
                        geometry.type === 'MultiPoint' ||
                        geometry.type === 'Polygon' ||
                        geometry.type === 'MultiLineString' ||
                        geometry.type === 'MultiPolygon') {
                        callback(geometry, currentIndex);
                        currentIndex++;
                    } else if (geometry.type === 'GeometryCollection') {
                        for (j = 0; j < geometry.geometries.length; j++) {
                            callback(geometry.geometries[j], currentIndex);
                            currentIndex++;
                        }
                    } else {
                        throw new Error('Unknown Geometry Type');
                    }
                }
            }
        }
        module.exports.geomEach = geomEach;

        /**
         * Callback for geomReduce
         *
         * The first time the callback function is called, the values provided as arguments depend
         * on whether the reduce method has an initialValue argument.
         *
         * If an initialValue is provided to the reduce method:
         *  - The previousValue argument is initialValue.
         *  - The currentValue argument is the value of the first element present in the array.
         *
         * If an initialValue is not provided:
         *  - The previousValue argument is the value of the first element present in the array.
         *  - The currentValue argument is the value of the second element present in the array.
         *
         * @private
         * @callback geomReduceCallback
         * @param {*} previousValue The accumulated value previously returned in the last invocation
         * of the callback, or initialValue, if supplied.
         * @param {*} currentGeometry The current Feature being processed.
         * @param {number} currentIndex The index of the current element being processed in the
         * array.Starts at index 0, if an initialValue is provided, and at index 1 otherwise.
         */

        /**
         * Reduce geometry in any GeoJSON object, similar to Array.reduce().
         *
         * @name geomReduce
         * @param {Object} layer any GeoJSON object
         * @param {Function} callback a method that takes (previousValue, currentGeometry, currentIndex)
         * @param {*} [initialValue] Value to use as the first argument to the first call of the callback.
         * @returns {*} The value that results from the reduction.
         * @example
         * var features = {
         *   "type": "FeatureCollection",
         *   "features": [
         *     {
         *       "type": "Feature",
         *       "properties": {"foo": "bar"},
         *       "geometry": {
         *         "type": "Point",
         *         "coordinates": [26, 37]
         *       }
         *     },
         *     {
         *       "type": "Feature",
         *       "properties": {"hello": "world"},
         *       "geometry": {
         *         "type": "Point",
         *         "coordinates": [36, 53]
         *       }
         *     }
         *   ]
         * };
         * turf.geomReduce(features, function (previousValue, currentGeometry, currentIndex) {
         *   //=previousValue
         *   //=currentGeometry
         *   //=currentIndex
         *   return currentGeometry
         * });
         */
        function geomReduce(layer, callback, initialValue) {
            var previousValue = initialValue;
            geomEach(layer, function (currentGeometry, currentIndex) {
                if (currentIndex === 0 && initialValue === undefined) {
                    previousValue = currentGeometry;
                } else {
                    previousValue = callback(previousValue, currentGeometry, currentIndex);
                }
            });
            return previousValue;
        }
        module.exports.geomReduce = geomReduce;

    }, {}],
    11: [function (require, module, exports) {
        'use strict';

        module.exports = partialSort;

        // Floyd-Rivest selection algorithm:
        // Rearrange items so that all items in the [left, k] range are smaller than all items in (k, right];
        // The k-th element will have the (k - left + 1)th smallest value in [left, right]

        function partialSort(arr, k, left, right, compare) {
            left = left || 0;
            right = right || (arr.length - 1);
            compare = compare || defaultCompare;

            while (right > left) {
                if (right - left > 600) {
                    var n = right - left + 1;
                    var m = k - left + 1;
                    var z = Math.log(n);
                    var s = 0.5 * Math.exp(2 * z / 3);
                    var sd = 0.5 * Math.sqrt(z * s * (n - s) / n) * (m - n / 2 < 0 ? -1 : 1);
                    var newLeft = Math.max(left, Math.floor(k - m * s / n + sd));
                    var newRight = Math.min(right, Math.floor(k + (n - m) * s / n + sd));
                    partialSort(arr, k, newLeft, newRight, compare);
                }

                var t = arr[k];
                var i = left;
                var j = right;

                swap(arr, left, k);
                if (compare(arr[right], t) > 0) swap(arr, left, right);

                while (i < j) {
                    swap(arr, i, j);
                    i++;
                    j--;
                    while (compare(arr[i], t) < 0) i++;
                    while (compare(arr[j], t) > 0) j--;
                }

                if (compare(arr[left], t) === 0) swap(arr, left, j);
                else {
                    j++;
                    swap(arr, j, right);
                }

                if (j <= k) left = j + 1;
                if (k <= j) right = j - 1;
            }
        }

        function swap(arr, i, j) {
            var tmp = arr[i];
            arr[i] = arr[j];
            arr[j] = tmp;
        }

        function defaultCompare(a, b) {
            return a < b ? -1 : a > b ? 1 : 0;
        }

    }, {}],
    12: [function (require, module, exports) {
        'use strict';

        module.exports = rbush;

        var quickselect = require('quickselect');

        function rbush(maxEntries, format) {
            if (!(this instanceof rbush)) return new rbush(maxEntries, format);

            // max entries in a node is 9 by default; min node fill is 40% for best performance
            this._maxEntries = Math.max(4, maxEntries || 9);
            this._minEntries = Math.max(2, Math.ceil(this._maxEntries * 0.4));

            if (format) {
                this._initFormat(format);
            }

            this.clear();
        }

        rbush.prototype = {

            all: function () {
                return this._all(this.data, []);
            },

            search: function (bbox) {

                var node = this.data,
                    result = [],
                    toBBox = this.toBBox;

                if (!intersects(bbox, node)) return result;

                var nodesToSearch = [],
                    i, len, child, childBBox;

                while (node) {
                    for (i = 0, len = node.children.length; i < len; i++) {

                        child = node.children[i];
                        childBBox = node.leaf ? toBBox(child) : child;

                        if (intersects(bbox, childBBox)) {
                            if (node.leaf) result.push(child);
                            else if (contains(bbox, childBBox)) this._all(child, result);
                            else nodesToSearch.push(child);
                        }
                    }
                    node = nodesToSearch.pop();
                }

                return result;
            },

            collides: function (bbox) {

                var node = this.data,
                    toBBox = this.toBBox;

                if (!intersects(bbox, node)) return false;

                var nodesToSearch = [],
                    i, len, child, childBBox;

                while (node) {
                    for (i = 0, len = node.children.length; i < len; i++) {

                        child = node.children[i];
                        childBBox = node.leaf ? toBBox(child) : child;

                        if (intersects(bbox, childBBox)) {
                            if (node.leaf || contains(bbox, childBBox)) return true;
                            nodesToSearch.push(child);
                        }
                    }
                    node = nodesToSearch.pop();
                }

                return false;
            },

            load: function (data) {
                if (!(data && data.length)) return this;

                if (data.length < this._minEntries) {
                    for (var i = 0, len = data.length; i < len; i++) {
                        this.insert(data[i]);
                    }
                    return this;
                }

                // recursively build the tree with the given data from stratch using OMT algorithm
                var node = this._build(data.slice(), 0, data.length - 1, 0);

                if (!this.data.children.length) {
                    // save as is if tree is empty
                    this.data = node;

                } else if (this.data.height === node.height) {
                    // split root if trees have the same height
                    this._splitRoot(this.data, node);

                } else {
                    if (this.data.height < node.height) {
                        // swap trees if inserted one is bigger
                        var tmpNode = this.data;
                        this.data = node;
                        node = tmpNode;
                    }

                    // insert the small tree into the large tree at appropriate level
                    this._insert(node, this.data.height - node.height - 1, true);
                }

                return this;
            },

            insert: function (item) {
                if (item) this._insert(item, this.data.height - 1);
                return this;
            },

            clear: function () {
                this.data = createNode([]);
                return this;
            },

            remove: function (item, equalsFn) {
                if (!item) return this;

                var node = this.data,
                    bbox = this.toBBox(item),
                    path = [],
                    indexes = [],
                    i, parent, index, goingUp;

                // depth-first iterative tree traversal
                while (node || path.length) {

                    if (!node) { // go up
                        node = path.pop();
                        parent = path[path.length - 1];
                        i = indexes.pop();
                        goingUp = true;
                    }

                    if (node.leaf) { // check current node
                        index = findItem(item, node.children, equalsFn);

                        if (index !== -1) {
                            // item found, remove the item and condense tree upwards
                            node.children.splice(index, 1);
                            path.push(node);
                            this._condense(path);
                            return this;
                        }
                    }

                    if (!goingUp && !node.leaf && contains(node, bbox)) { // go down
                        path.push(node);
                        indexes.push(i);
                        i = 0;
                        parent = node;
                        node = node.children[0];

                    } else if (parent) { // go right
                        i++;
                        node = parent.children[i];
                        goingUp = false;

                    } else node = null; // nothing found
                }

                return this;
            },

            toBBox: function (item) {
                return item;
            },

            compareMinX: compareNodeMinX,
            compareMinY: compareNodeMinY,

            toJSON: function () {
                return this.data;
            },

            fromJSON: function (data) {
                this.data = data;
                return this;
            },

            _all: function (node, result) {
                var nodesToSearch = [];
                while (node) {
                    if (node.leaf) result.push.apply(result, node.children);
                    else nodesToSearch.push.apply(nodesToSearch, node.children);

                    node = nodesToSearch.pop();
                }
                return result;
            },

            _build: function (items, left, right, height) {

                var N = right - left + 1,
                    M = this._maxEntries,
                    node;

                if (N <= M) {
                    // reached leaf level; return leaf
                    node = createNode(items.slice(left, right + 1));
                    calcBBox(node, this.toBBox);
                    return node;
                }

                if (!height) {
                    // target height of the bulk-loaded tree
                    height = Math.ceil(Math.log(N) / Math.log(M));

                    // target number of root entries to maximize storage utilization
                    M = Math.ceil(N / Math.pow(M, height - 1));
                }

                node = createNode([]);
                node.leaf = false;
                node.height = height;

                // split the items into M mostly square tiles

                var N2 = Math.ceil(N / M),
                    N1 = N2 * Math.ceil(Math.sqrt(M)),
                    i, j, right2, right3;

                multiSelect(items, left, right, N1, this.compareMinX);

                for (i = left; i <= right; i += N1) {

                    right2 = Math.min(i + N1 - 1, right);

                    multiSelect(items, i, right2, N2, this.compareMinY);

                    for (j = i; j <= right2; j += N2) {

                        right3 = Math.min(j + N2 - 1, right2);

                        // pack each entry recursively
                        node.children.push(this._build(items, j, right3, height - 1));
                    }
                }

                calcBBox(node, this.toBBox);

                return node;
            },

            _chooseSubtree: function (bbox, node, level, path) {

                var i, len, child, targetNode, area, enlargement, minArea, minEnlargement;

                while (true) {
                    path.push(node);

                    if (node.leaf || path.length - 1 === level) break;

                    minArea = minEnlargement = Infinity;

                    for (i = 0, len = node.children.length; i < len; i++) {
                        child = node.children[i];
                        area = bboxArea(child);
                        enlargement = enlargedArea(bbox, child) - area;

                        // choose entry with the least area enlargement
                        if (enlargement < minEnlargement) {
                            minEnlargement = enlargement;
                            minArea = area < minArea ? area : minArea;
                            targetNode = child;

                        } else if (enlargement === minEnlargement) {
                            // otherwise choose one with the smallest area
                            if (area < minArea) {
                                minArea = area;
                                targetNode = child;
                            }
                        }
                    }

                    node = targetNode || node.children[0];
                }

                return node;
            },

            _insert: function (item, level, isNode) {

                var toBBox = this.toBBox,
                    bbox = isNode ? item : toBBox(item),
                    insertPath = [];

                // find the best node for accommodating the item, saving all nodes along the path too
                var node = this._chooseSubtree(bbox, this.data, level, insertPath);

                // put the item into the node
                node.children.push(item);
                extend(node, bbox);

                // split on node overflow; propagate upwards if necessary
                while (level >= 0) {
                    if (insertPath[level].children.length > this._maxEntries) {
                        this._split(insertPath, level);
                        level--;
                    } else break;
                }

                // adjust bboxes along the insertion path
                this._adjustParentBBoxes(bbox, insertPath, level);
            },

            // split overflowed node into two
            _split: function (insertPath, level) {

                var node = insertPath[level],
                    M = node.children.length,
                    m = this._minEntries;

                this._chooseSplitAxis(node, m, M);

                var splitIndex = this._chooseSplitIndex(node, m, M);

                var newNode = createNode(node.children.splice(splitIndex, node.children.length - splitIndex));
                newNode.height = node.height;
                newNode.leaf = node.leaf;

                calcBBox(node, this.toBBox);
                calcBBox(newNode, this.toBBox);

                if (level) insertPath[level - 1].children.push(newNode);
                else this._splitRoot(node, newNode);
            },

            _splitRoot: function (node, newNode) {
                // split root node
                this.data = createNode([node, newNode]);
                this.data.height = node.height + 1;
                this.data.leaf = false;
                calcBBox(this.data, this.toBBox);
            },

            _chooseSplitIndex: function (node, m, M) {

                var i, bbox1, bbox2, overlap, area, minOverlap, minArea, index;

                minOverlap = minArea = Infinity;

                for (i = m; i <= M - m; i++) {
                    bbox1 = distBBox(node, 0, i, this.toBBox);
                    bbox2 = distBBox(node, i, M, this.toBBox);

                    overlap = intersectionArea(bbox1, bbox2);
                    area = bboxArea(bbox1) + bboxArea(bbox2);

                    // choose distribution with minimum overlap
                    if (overlap < minOverlap) {
                        minOverlap = overlap;
                        index = i;

                        minArea = area < minArea ? area : minArea;

                    } else if (overlap === minOverlap) {
                        // otherwise choose distribution with minimum area
                        if (area < minArea) {
                            minArea = area;
                            index = i;
                        }
                    }
                }

                return index;
            },

            // sorts node children by the best axis for split
            _chooseSplitAxis: function (node, m, M) {

                var compareMinX = node.leaf ? this.compareMinX : compareNodeMinX,
                    compareMinY = node.leaf ? this.compareMinY : compareNodeMinY,
                    xMargin = this._allDistMargin(node, m, M, compareMinX),
                    yMargin = this._allDistMargin(node, m, M, compareMinY);

                // if total distributions margin value is minimal for x, sort by minX,
                // otherwise it's already sorted by minY
                if (xMargin < yMargin) node.children.sort(compareMinX);
            },

            // total margin of all possible split distributions where each node is at least m full
            _allDistMargin: function (node, m, M, compare) {

                node.children.sort(compare);

                var toBBox = this.toBBox,
                    leftBBox = distBBox(node, 0, m, toBBox),
                    rightBBox = distBBox(node, M - m, M, toBBox),
                    margin = bboxMargin(leftBBox) + bboxMargin(rightBBox),
                    i, child;

                for (i = m; i < M - m; i++) {
                    child = node.children[i];
                    extend(leftBBox, node.leaf ? toBBox(child) : child);
                    margin += bboxMargin(leftBBox);
                }

                for (i = M - m - 1; i >= m; i--) {
                    child = node.children[i];
                    extend(rightBBox, node.leaf ? toBBox(child) : child);
                    margin += bboxMargin(rightBBox);
                }

                return margin;
            },

            _adjustParentBBoxes: function (bbox, path, level) {
                // adjust bboxes along the given tree path
                for (var i = level; i >= 0; i--) {
                    extend(path[i], bbox);
                }
            },

            _condense: function (path) {
                // go through the path, removing empty nodes and updating bboxes
                for (var i = path.length - 1, siblings; i >= 0; i--) {
                    if (path[i].children.length === 0) {
                        if (i > 0) {
                            siblings = path[i - 1].children;
                            siblings.splice(siblings.indexOf(path[i]), 1);

                        } else this.clear();

                    } else calcBBox(path[i], this.toBBox);
                }
            },

            _initFormat: function (format) {
                // data format (minX, minY, maxX, maxY accessors)

                // uses eval-type function compilation instead of just accepting a toBBox function
                // because the algorithms are very sensitive to sorting functions performance,
                // so they should be dead simple and without inner calls

                var compareArr = ['return a', ' - b', ';'];

                this.compareMinX = new Function('a', 'b', compareArr.join(format[0]));
                this.compareMinY = new Function('a', 'b', compareArr.join(format[1]));

                this.toBBox = new Function('a',
                    'return {minX: a' + format[0] +
                    ', minY: a' + format[1] +
                    ', maxX: a' + format[2] +
                    ', maxY: a' + format[3] + '};');
            }
        };

        function findItem(item, items, equalsFn) {
            if (!equalsFn) return items.indexOf(item);

            for (var i = 0; i < items.length; i++) {
                if (equalsFn(item, items[i])) return i;
            }
            return -1;
        }

        // calculate node's bbox from bboxes of its children
        function calcBBox(node, toBBox) {
            distBBox(node, 0, node.children.length, toBBox, node);
        }

        // min bounding rectangle of node children from k to p-1
        function distBBox(node, k, p, toBBox, destNode) {
            if (!destNode) destNode = createNode(null);
            destNode.minX = Infinity;
            destNode.minY = Infinity;
            destNode.maxX = -Infinity;
            destNode.maxY = -Infinity;

            for (var i = k, child; i < p; i++) {
                child = node.children[i];
                extend(destNode, node.leaf ? toBBox(child) : child);
            }

            return destNode;
        }

        function extend(a, b) {
            a.minX = Math.min(a.minX, b.minX);
            a.minY = Math.min(a.minY, b.minY);
            a.maxX = Math.max(a.maxX, b.maxX);
            a.maxY = Math.max(a.maxY, b.maxY);
            return a;
        }

        function compareNodeMinX(a, b) {
            return a.minX - b.minX;
        }

        function compareNodeMinY(a, b) {
            return a.minY - b.minY;
        }

        function bboxArea(a) {
            return (a.maxX - a.minX) * (a.maxY - a.minY);
        }

        function bboxMargin(a) {
            return (a.maxX - a.minX) + (a.maxY - a.minY);
        }

        function enlargedArea(a, b) {
            return (Math.max(b.maxX, a.maxX) - Math.min(b.minX, a.minX)) *
                (Math.max(b.maxY, a.maxY) - Math.min(b.minY, a.minY));
        }

        function intersectionArea(a, b) {
            var minX = Math.max(a.minX, b.minX),
                minY = Math.max(a.minY, b.minY),
                maxX = Math.min(a.maxX, b.maxX),
                maxY = Math.min(a.maxY, b.maxY);

            return Math.max(0, maxX - minX) *
                Math.max(0, maxY - minY);
        }

        function contains(a, b) {
            return a.minX <= b.minX &&
                a.minY <= b.minY &&
                b.maxX <= a.maxX &&
                b.maxY <= a.maxY;
        }

        function intersects(a, b) {
            return b.minX <= a.maxX &&
                b.minY <= a.maxY &&
                b.maxX >= a.minX &&
                b.maxY >= a.minY;
        }

        function createNode(children) {
            return {
                children: children,
                height: 1,
                leaf: true,
                minX: Infinity,
                minY: Infinity,
                maxX: -Infinity,
                maxY: -Infinity
            };
        }

        // sort an array so that items come in groups of n unsorted items, with groups sorted between each other;
        // combines selection algorithm with binary divide & conquer approach

        function multiSelect(arr, left, right, n, compare) {
            var stack = [left, right],
                mid;

            while (stack.length) {
                right = stack.pop();
                left = stack.pop();

                if (right - left <= n) continue;

                mid = left + Math.ceil((right - left) / n / 2) * n;
                quickselect(arr, mid, left, right, compare);

                stack.push(left, mid, mid, right);
            }
        }

    }, {
        "quickselect": 11
    }]
}, {}, [2]);