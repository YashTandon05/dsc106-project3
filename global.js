import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';
import * as topojson from 'https://cdn.jsdelivr.net/npm/topojson-client@3/+esm';

const width = 960;
const height = 600;

const svg = d3.select("#map").attr("width", width).attr("height", height);
const g = svg.append('g');

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

// Vars to store data
let worldData = null;
let csvData = {};
let baselineData = {};
let currentYear = 1850;
let measure = 'absolute'; // 'absolute' or 'change'
let colorScale = null;
let colorScaleAbsolute = null;
let colorScaleChange = null;

// Load CSV temp data
Promise.all([
    d3.json('https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json'),
    d3.csv('data/cmip6_tas_country_annual.csv')]).then(([world, csv]) => {
        worldData = world;

        // First pass: store baseline (1850) temperatures
        csv.forEach(d => {
            const year = +d.year;
            const isoCode = String(d.iso_num);
            const value = d.avg_temp_absolute ? +d.avg_temp_absolute : null;
            
            if (year === 1850 && value !== null && !isNaN(value)) {
                baselineData[isoCode] = value;
            }
        });
        
        // Second pass: store all data with percentage changes
        csv.forEach(d => {
            const year = +d.year;
            const isoCode = String(d.iso_num);
            const value = d.avg_temp_absolute ? +d.avg_temp_absolute : null;
            
            if (!csvData[year]) {
                csvData[year] = {};
            }
            
            if (value !== null && !isNaN(value)) {                
                csvData[year][isoCode] = {
                    country: d.country,
                    value: value,
                    change: d.avg_temp_change ? +d.avg_temp_change : null,
                    percentChange: d.avg_temp_change ? +d.avg_temp_change : null,
                };
            }
        });
    
        // Create color scales
        const allValues = csv.filter(d => d.avg_temp_absolute).map(d => +d.avg_temp_absolute);
        const minValue = d3.min(allValues);
        const maxValue = d3.max(allValues);
        
        // Sequential color scale for absolute values (reversed so red = hot, blue = cold)
        colorScaleAbsolute = d3.scaleSequential(d3.interpolateRdYlBu).domain([maxValue, minValue]);
        
        // Calculate max absolute percentage change for diverging scale
        const allPercentChanges = [];
        Object.keys(csvData).forEach(year => {
            Object.keys(csvData[year]).forEach(isoCode => {
                const data = csvData[year][isoCode];
                if (data.percentChange !== null && !isNaN(data.percentChange)) {
                    allPercentChanges.push(Math.abs(data.percentChange));
                }
            });
        });
        const maxPercentChange = d3.max(allPercentChanges) || 5; // Default to 5% if no data
        
        // Diverging color scale for % change (centered at 0)
        colorScaleChange = d3.scaleDiverging(d3.interpolateRdBu)
            .domain([-maxPercentChange, 0, maxPercentChange]);
        
        // Set initial color scale
        colorScale = colorScaleAbsolute;
        
        drawMap(currentYear);
        drawLegend();
        
        const yearSlider = d3.select("#yearSlider");
        const yearValue = d3.select("#yearValue");
        
        yearSlider.on("input", function() {
            currentYear = +this.value;
            yearValue.text(currentYear);
            drawMap(currentYear);
        });
        
        // Event listener for measure toggle
        d3.selectAll('input[name="measure"]').on("change", function() {
            measure = this.value;
            // Update color scale based on measure
            colorScale = measure === 'absolute' ? colorScaleAbsolute : colorScaleChange;
            // Redraw map and legend
            drawMap(currentYear);
            drawLegend();
        });
    }
);

function drawLegend() {
    if (!colorScale) return;
    
    // Remove existing legend
    svg.selectAll(".legend").remove();
    
    const legendWidth = 300;
    const legendHeight = 20;
    const legendX = width - legendWidth - 20;
    const legendY = height - 40;
    
    const legend = svg.append("g")
        .attr("class", "legend")
        .attr("transform", `translate(${legendX}, ${legendY})`);
    
    const domain = colorScale.domain();
    // For diverging scale, domain has 3 elements [min, center, max]
    // For sequential scale, domain has 2 elements [max, min]
    const legendDomain = measure === 'absolute' 
        ? domain  // Sequential: [max, min]
        : [domain[0], domain[2]];  // Diverging: use [min, max] for axis
    
    const legendScale = d3.scaleLinear()
        .domain(legendDomain)
        .range([0, legendWidth]);
    
    // Create axis with appropriate format based on measure
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
    
    // Gradient for legend
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
            
            // TODO 
        });
}


