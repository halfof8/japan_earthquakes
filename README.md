# japan_earthquakes
Last Decade of Earthquake in Japan

Author: Anton Sokolov


## Proccess
1. We used iso 3166 standart with ID of Japan to export borders in geojson. 
https://wambachers-osm.website/boundaries/

Than we used hextile library to create border-based hexagon grid.

Thank to earthquake gov we have set of points that encorporage date about earthquakes for last decade.

Each point has two parameters - weight (magnitude) and depth. 

The idea is to calculate affection of entire array of points affects on the individual hexagon. Weight and depth linearly reduce the affection.

We need to find all the centers of the hexagons, then take the distance to the centers to each point to the pego coordinates. Then multiply by weight and divide by depth. The result is added to the new array of summarized effects.

 