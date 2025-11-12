import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';
import * as topojson from 'https://cdn.jsdelivr.net/npm/topojson-client@3/+esm';

const width = 960;
const height = 600;

const svg = d3.select("#map").attr("width", width).attr("height", height);
const g = svg.append('g');

// Setup zoom behavior
const zoom = d3.zoom()
    .scaleExtent([1, 8])  // Allow zoom from 1x to 8x
    .on('zoom', (event) => {
        g.attr('transform', event.transform);
    });

// Apply zoom to SVG
svg.call(zoom);

const projection = d3.geoMercator().scale(140).translate([width/2, height/1.5]);
const path = d3.geoPath(projection);

const tooltip = d3.select("#tooltip")
    .style("position", "absolute")
    .style("background", "rgba(0, 0, 0, 0.8)")
    .style("color", "white")
    .style("padding", "10px")
    .style("border-radius", "5px")
    .style("pointer-events", "none")
    .style("opacity", 0)
    .style("font-size", "12px");

let worldData = null;
let csvData = {};
let currentYear = 2014;
let measure = 'absolute';
let colorScale = null;
let colorScaleAbsolute = null;
let colorScaleChange = null;

if (localStorage.year) {
    currentYear = +localStorage.year;
    if (currentYear < 1850 || currentYear > 2014) {
        currentYear = 2014;
        localStorage.year = currentYear;
    }
}

// Load and initialize data
async function loadData() {
    const [world, csv] = await Promise.all([
        d3.json('https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json'),
        d3.csv('data/cmip6_tas_country_annual.csv')
    ]);
    
    worldData = world;
    
    // CSV Data Processing
    csv.forEach(d => {
        const year = +d.year;
        const isoCode = String(d.iso_num);
        
        if (!csvData[year]) {
            csvData[year] = {};
        }
                      
        csvData[year][isoCode] = {
            country: d.country,
            value: d.avg_temp_absolute ? +d.avg_temp_absolute : null,
            change: d.avg_temp_change ? +d.avg_temp_change : null,
            percentChange: d.avg_temp_change ? +d.avg_temp_change : null,
        };
    });
    
    // Color Scales for both metrics
    const allValues = csv.filter(d => d.avg_temp_absolute).map(d => +d.avg_temp_absolute);
    const minValue = d3.min(allValues);
    const maxValue = d3.max(allValues);
    const interpolateBlYlRd = t => d3.interpolateRdYlBu(1 - t);
    colorScaleAbsolute = d3.scaleSequential(interpolateBlYlRd).domain([minValue, maxValue]);

    const allPercentChanges = [];
    Object.keys(csvData).forEach(year => {
        Object.keys(csvData[year]).forEach(isoCode => {
            const data = csvData[year][isoCode];
            if (data.percentChange !== null && !isNaN(data.percentChange)) {
                allPercentChanges.push(Math.abs(data.percentChange));
            }
        });
    });
    const maxPercentChange = d3.max(allPercentChanges);
    const interpolateBlRd = t => d3.interpolateRdBu(1 - t);
    colorScaleChange = d3.scaleDiverging(interpolateBlRd).domain([-maxPercentChange, 0, maxPercentChange]);
    
    // Local Storage for remembering settings
    // TODO : Add remembering year on slider
    if (localStorage.measure) {
        measure = localStorage.measure;
    } else {
        measure = 'absolute';
        localStorage.measure = measure;
    }
    colorScale = measure === 'absolute' ? colorScaleAbsolute : colorScaleChange;
    
    drawMap(currentYear);
    drawLegend();
    createYearSlider();
    createMeasureToggle();
}

loadData();

function drawLegend() {
    if (!colorScale) return;

    svg.selectAll(".legend").remove();
    
    const legendWidth = 300;
    const legendHeight = 20;
    const legendX = width - legendWidth - 20;
    const legendY = height - 40;
    
    const legend = svg.append("g").attr("class", "legend").attr("transform", `translate(${legendX}, ${legendY})`);
    
    const domain = colorScale.domain();
    const legendDomain = measure === 'absolute' ? domain : [domain[0], domain[2]];
    
    const legendScale = d3.scaleLinear().domain(legendDomain).range([0, legendWidth]);
    
    let legendAxis;
    if (measure === 'absolute') {
        legendAxis = d3.axisBottom(legendScale)
            .ticks(5)
            .tickFormat(d => d.toFixed(1) + "°C");
    } else {
        legendAxis = d3.axisBottom(legendScale)
            .ticks(5)
            .tickFormat(d => (d > 0 ? '+' : '') + d.toFixed(1) + "%");
    }
    
    const gradient = legend.append("defs")
        .append("linearGradient")
        .attr("id", "legend-gradient")
        .attr("x1", "0%")
        .attr("x2", "100%");
    
    const numStops = 10;
    for (let i = 0; i <= numStops; i++) {
        let value;
        if (measure === 'absolute') {
            // Sequential scale: interpolate from max to min
            value = d3.interpolateNumber(domain[0], domain[1])(i / numStops);
        } else {
            // Diverging scale: interpolate from negative to positive through 0
            // Domain is [min, center, max] = [-maxPercentChange, 0, maxPercentChange]
            value = d3.interpolateNumber(domain[0], domain[2])(i / numStops);
        }
        gradient.append("stop")
            .attr("offset", `${(i / numStops) * 100}%`)
            .attr("stop-color", colorScale(value));
    }
    
    legend.append("rect")
        .attr("width", legendWidth)
        .attr("height", legendHeight)
        .style("fill", "url(#legend-gradient)")
        .style("stroke", "#000")
        .style("stroke-width", 1);
    
    legend.append("g")
        .attr("transform", `translate(0, ${legendHeight})`)
        .call(legendAxis);
    
    // Legend title based on measure
    const legendTitle = measure === 'absolute' 
        ? "Average Temperature (°C)" 
        : "Temperature Change (Δ)";
    
    legend.append("text")
        .attr("x", legendWidth / 2)
        .attr("y", -5)
        .style("text-anchor", "middle")
        .style("font-size", "12px")
        .style("font-weight", "bold")
        .text(legendTitle);
}

function drawMap(year) {
    if (!worldData) return;
    
    const countries = topojson.feature(worldData, worldData.objects.countries);
    const yearData = csvData[year] || {};

    const countriesPath = g.selectAll('path.country').data(countries.features);
    
    countriesPath.exit().remove();
    
    const countriesEnter = countriesPath.enter()
        .append('path')
        .attr('class', 'country')
        .attr('d', path)
        .style("cursor", "pointer");
    
    const countriesUpdate = countriesEnter.merge(countriesPath).attr('d', path).attr('fill', d => {
            const isoCode = String(d.id);
            const data = yearData[isoCode];
            
            if (data && colorScale) {
                let valueToUse = null;
                if (measure === 'absolute') {
                    valueToUse = data.value;
                } else {
                    valueToUse = data.percentChange;
                }
                
                if (valueToUse !== null && !isNaN(valueToUse)) {
                    const color = colorScale(valueToUse);
                    return color;
                }
            }
            return '#ccc';
        }).attr('stroke', '#fff').attr('stroke-width', 0.5)
        .on('mouseover', function(event, d) {
            const isoCode = String(d.id);
            const data = yearData[isoCode];
            
            d3.select(this).attr('stroke', '#000').attr('stroke-width', 2);

            if (data) {
                let tooltipHtml = `<strong>${data.country}</strong><br/>Year: ${year}<br/>`;
                
                if (measure === 'absolute') {
                    tooltipHtml += `Temperature: ${data.value.toFixed(2)}°C`;
                    if (data.percentChange !== null && !isNaN(data.percentChange)) {
                        tooltipHtml += `<br/>Δ: ${data.percentChange > 0 ? '+' : ''}${data.percentChange.toFixed(2)}%`;
                    }
                } else {
                    if (data.percentChange !== null && !isNaN(data.percentChange)) {
                        tooltipHtml += `Δ Temperature: ${data.percentChange > 0 ? '+' : ''}${data.percentChange.toFixed(2)}%`;
                        tooltipHtml += `<br/>Temperature: ${data.value.toFixed(2)}°C`;
                    } else {
                        tooltipHtml += `Δ Temperature: N/A`;
                    }
                }
                
                tooltip
                    .style('opacity', 1)
                    .html(tooltipHtml)
                    .style('left', (event.pageX + 10) + 'px')
                    .style('top', (event.pageY - 10) + 'px');
            } else {
                tooltip
                    .style('opacity', 1)
                    .html(`
                        <strong>${d.properties.name || 'Unknown'}</strong><br/>
                        Year: ${year}<br/>
                        No data available
                    `)
                    .style('left', (event.pageX + 10) + 'px')
                    .style('top', (event.pageY - 10) + 'px');
            }
        })
        .on('mousemove', function(event) {
            tooltip
                .style('left', (event.pageX + 10) + 'px')
                .style('top', (event.pageY - 10) + 'px');
        })
        .on('mouseout', function() {
            d3.select(this)
                .attr('stroke', '#fff')
                .attr('stroke-width', 0.5);
            tooltip.style('opacity', 0);
        })
        .on('click', function(event, d) {
            const isoCode = String(d.id);
            const data = yearData[isoCode];
            
            if (data) {
                showCountryModal(isoCode, data.country);
            }
        });
}

function createYearSlider() {
    const yearSlider = d3.select("#yearSlider");
    const yearValue = d3.select("#yearValue");

    yearSlider.property("value", currentYear);
    yearValue.text("Year: " + currentYear);
    
    yearSlider.on("input", function() {
        currentYear = +this.value;
        yearValue.text("Year: " + currentYear);
        localStorage.year = currentYear;
        drawMap(currentYear);
    });
}

function createMeasureToggle() {
    const checkbox = document.getElementById('measureCheckbox');
    
    // Set initial state
    // unchecked = absolute, checked = change
    checkbox.checked = (measure === 'change');
    
    // Add event listener
    checkbox.addEventListener('change', function(event) {
        measure = event.target.checked ? 'change' : 'absolute';
        localStorage.measure = measure;
        
        colorScale = measure === 'absolute' ? colorScaleAbsolute : colorScaleChange;
        
        drawMap(currentYear);
        drawLegend();
    });
}

// Simple 1D Kalman Filter for smoothing temperature data
function kalmanFilter(data, processNoise = 0.01, measurementNoise = 0.6) {
    if (data.length === 0) return data;
    
    const smoothedData = [];
    let estimate = data[0].temperature; // Initial estimate
    let errorEstimate = 1.0; // Initial error estimate
    
    data.forEach((point, i) => {
        // Prediction step
        const predictedEstimate = estimate;
        const predictedError = errorEstimate + processNoise;
        
        // Update step
        const kalmanGain = predictedError / (predictedError + measurementNoise);
        estimate = predictedEstimate + kalmanGain * (point.temperature - predictedEstimate);
        errorEstimate = (1 - kalmanGain) * predictedError;
        
        smoothedData.push({
            year: point.year,
            temperature: estimate,
            originalTemperature: point.temperature
        });
    });
    
    return smoothedData;
}

function showCountryModal(isoCode, countryName) {
    // Get all data for this country across all years
    const countryData = [];
    Object.keys(csvData).forEach(year => {
        if (csvData[year][isoCode]) {
            const data = csvData[year][isoCode];
            if (data.value !== null && !isNaN(data.value)) {
                countryData.push({
                    year: +year,
                    temperature: data.value
                });
            }
        }
    });
    
    // Sort by year
    countryData.sort((a, b) => a.year - b.year);
    
    if (countryData.length === 0) {
        return; // No data to display
    }
    
    // Show modal
    const modal = d3.select("#modal");
    modal.style("display", "flex");
    
    // Clear previous content
    modal.selectAll("*").remove();
    
    // Create modal content container
    const modalContent = modal.append("div")
        .attr("class", "modal-content");
    
    // Add close button
    modalContent.append("button")
        .attr("class", "close-button")
        .html("&times;")
        .on("click", function() {
            modal.style("display", "none");
        });
    
    // Add title
    modalContent.append("h2")
        .attr("class", "line-graph-title")
        .text(`Temperature History: ${countryName}`);
    
    // Add legend explaining the lines
    const legendDiv = modalContent.append("div")
        .style("text-align", "center")
        .style("margin-bottom", "10px")
        .style("font-size", "12px")
        .style("color", "#666");
    
    legendDiv.append("span")
        .style("color", "rgba(231, 76, 60, 0.3)")
        .style("font-weight", "bold")
        .text("━ Original Data  ");
    
    legendDiv.append("span")
        .style("color", "#e74c3c")
        .style("font-weight", "bold")
        .text("━ Kalman Smoothed");
    
    // Create SVG for line graph
    const graphWidth = 800;
    const graphHeight = 400;
    const margin = { top: 20, right: 30, bottom: 50, left: 60 };
    const innerWidth = graphWidth - margin.left - margin.right;
    const innerHeight = graphHeight - margin.top - margin.bottom;
    
    const graphSvg = modalContent.append("svg")
        .attr("class", "line-graph-container")
        .attr("width", graphWidth)
        .attr("height", graphHeight);
    
    // Create a group for the graph content (to be zoomed)
    const graphG = graphSvg.append("g")
        .attr("transform", `translate(${margin.left}, ${margin.top})`);
    
    // Create a clip path to keep graph within bounds
    graphSvg.append("defs").append("clipPath")
        .attr("id", "clip")
        .append("rect")
        .attr("width", innerWidth)
        .attr("height", innerHeight);
    
    // Create a group for zoomable content
    const zoomableContent = graphG.append("g")
        .attr("clip-path", "url(#clip)");
    
    // Create scales
    const xScale = d3.scaleLinear()
        .domain(d3.extent(countryData, d => d.year))
        .range([0, innerWidth]);
    
    const yScale = d3.scaleLinear()
        .domain([
            d3.min(countryData, d => d.temperature) - 1,
            d3.max(countryData, d => d.temperature) + 1
        ])
        .range([innerHeight, 0]);
    
    // Apply Kalman filter to smooth the data
    const smoothedData = kalmanFilter(countryData, 0.1, 0.5);
    
    // Create line generator for original data
    const lineOriginal = d3.line()
        .x(d => xScale(d.year))
        .y(d => yScale(d.temperature));
    
    // Create line generator for smoothed data
    const lineSmoothed = d3.line()
        .x(d => xScale(d.year))
        .y(d => yScale(d.temperature));
    
    // Draw the original line (lighter/more transparent)
    zoomableContent.append("path")
        .datum(countryData)
        .attr("fill", "none")
        .attr("stroke", "#e74c3c")
        .attr("stroke-width", 1)
        .attr("stroke-opacity", 0.3)
        .attr("d", lineOriginal);
    
    // Draw the smoothed line (prominent)
    zoomableContent.append("path")
        .datum(smoothedData)
        .attr("fill", "none")
        .attr("stroke", "#e74c3c")
        .attr("stroke-width", 2.5)
        .attr("d", lineSmoothed);
    
    // Add dots for each data point (using smoothed data)
    zoomableContent.selectAll("circle")
        .data(smoothedData)
        .enter()
        .append("circle")
        .attr("cx", d => xScale(d.year))
        .attr("cy", d => yScale(d.temperature))
        .attr("r", 3)
        .attr("fill", "#c0392b")
        .style("cursor", "pointer")
        .on("mouseover", function(event, d) {
            d3.select(this)
                .attr("r", 5)
                .attr("fill", "#e74c3c");
            
            // Show tooltip with both smoothed and original values
            tooltip
                .style("opacity", 1)
                .html(`<strong>Year: ${d.year}</strong><br/>Smoothed: ${d.temperature.toFixed(2)}°C<br/>Original: ${d.originalTemperature.toFixed(2)}°C`)
                .style("left", (event.pageX + 10) + "px")
                .style("top", (event.pageY - 10) + "px");
        })
        .on("mousemove", function(event) {
            tooltip
                .style("left", (event.pageX + 10) + "px")
                .style("top", (event.pageY - 10) + "px");
        })
        .on("mouseout", function() {
            d3.select(this)
                .attr("r", 3)
                .attr("fill", "#c0392b");
            tooltip.style("opacity", 0);
        });
    
    // Add X axis
    const xAxis = d3.axisBottom(xScale)
        .tickFormat(d3.format("d"));
    
    const xAxisGroup = graphG.append("g")
        .attr("class", "x-axis")
        .attr("transform", `translate(0, ${innerHeight})`)
        .call(xAxis);
    
    xAxisGroup.selectAll("text")
        .style("text-anchor", "end")
        .attr("dx", "-.8em")
        .attr("dy", ".15em")
        .attr("transform", "rotate(-45)");
    
    // Add Y axis
    const yAxis = d3.axisLeft(yScale);
    
    const yAxisGroup = graphG.append("g")
        .attr("class", "y-axis")
        .call(yAxis);
    
    // Setup zoom behavior for line graph
    const lineZoom = d3.zoom()
        .scaleExtent([1, 10])  // Allow zoom from 1x to 10x
        .on('zoom', (event) => {
            // Update scales based on transform
            const newXScale = event.transform.rescaleX(xScale);
            const newYScale = event.transform.rescaleY(yScale);
            
            // Update axes
            xAxisGroup.call(d3.axisBottom(newXScale).tickFormat(d3.format("d")));
            xAxisGroup.selectAll("text")
                .style("text-anchor", "end")
                .attr("dx", "-.8em")
                .attr("dy", ".15em")
                .attr("transform", "rotate(-45)");
            
            yAxisGroup.call(d3.axisLeft(newYScale));
            
            // Update line paths
            const lineOriginal = d3.line()
                .x(d => newXScale(d.year))
                .y(d => newYScale(d.temperature));
            
            const lineSmoothed = d3.line()
                .x(d => newXScale(d.year))
                .y(d => newYScale(d.temperature));
            
            zoomableContent.selectAll("path").data([countryData, smoothedData])
                .attr("d", (d, i) => i === 0 ? lineOriginal(d) : lineSmoothed(d));
            
            // Update circles
            zoomableContent.selectAll("circle")
                .attr("cx", d => newXScale(d.year))
                .attr("cy", d => newYScale(d.temperature));
        });
    
    // Apply zoom to the SVG
    graphSvg.call(lineZoom);
    
    // Add X axis label
    graphSvg.append("text")
        .attr("class", "axis-label")
        .attr("x", graphWidth / 2)
        .attr("y", graphHeight - 5)
        .style("text-anchor", "middle")
        .text("Year");
    
    // Add Y axis label
    graphSvg.append("text")
        .attr("class", "axis-label")
        .attr("transform", "rotate(-90)")
        .attr("x", -graphHeight / 2)
        .attr("y", 15)
        .style("text-anchor", "middle")
        .text("Temperature (°C)");
    
    // Close modal when clicking outside content
    modal.on("click", function(event) {
        if (event.target === this) {
            modal.style("display", "none");
        }
    });
}


