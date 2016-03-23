var _ = require('lodash')
var d3 = require('d3')
var jQuery = $ = require('jquery')
var Renderer = require('dataproofer').Rendering;

function HTMLRenderer(config) {
  console.log('config', config);
  Renderer.call(this, config)
  window.rows = config.rows;
  var resultList = {}
  config.suites.forEach(function(suite) {
    resultList[suite.name] = []
  })
  this.resultList = resultList;

  var data = []
  var headers = _.keys( rows[0] )
  _.forEach( rows, function(row) {
    data.push( _.values(row) )
  });
  var topBarHeight = document.getElementById('info-top-bar').getBoundingClientRect().height;
  var containerWidth = window.innerWidth / 2;
  var containerHeight = window.innerHeight - topBarHeight;
  var handsOnTable = new Handsontable(document.getElementById('grid'),
    {
      data: data,
      autoWrapRow: true,
      autoWrapCol: true,
      wordWrap: false,
      width: containerWidth,
      height: containerHeight,
      rowHeaders: true,
      colHeaders: headers,
      columnSorting: true,
      sortIndicator: true,
      readOnly: true,
      manualRowResize: true,
      manualColumnResize: true,
      autoColumnSize: {
        "samplingRatio": 23
      },
      currentRowClassName: 'currentRow',
      currentColClassName: 'currentCol',
    });

  this.handsOnTable = handsOnTable

  // we just remove everything rather than get into update pattern
  d3.select(".step-3-results").selectAll(".suite").remove();
  d3.select(".step-3-results").selectAll(".suite")
    .data(config.suites)
    .enter().append("div")
    .attr({
      class: function(d) { return "suite " + d.name + (d.active ? " active" : "" )}
    })
    .append("h2").text(function(d) { return d.name })
  //d3.select(".test-results").selectAll(".test").remove();
}

HTMLRenderer.prototype = Object.create(Renderer.prototype, {})
HTMLRenderer.prototype.constructor = HTMLRenderer;

HTMLRenderer.prototype.addResult = function(suite, test, result) {
  //console.log(suite, test.name());
  console.log("add result", suite, test.name(), result)
  this.resultList[suite].push({ suite: suite, test: test, result: result })

  var container = d3.select(".step-3-results ." + suite)
  var tests = container.selectAll(".test")
    .data(this.resultList[suite])

  var testsEnter = tests.enter().append("div")
  .attr("class", function(d) {
     return 'test' + (d.test.active ? " active" : "" )
  })
  testsEnter.append("div").classed("passfail", true)
  testsEnter.append("div").classed("message", true)
  testsEnter.append("div").classed("fingerprint", true).each(function(d) {
    if(d.result.highlightCells && d.result.highlightCells.length) {
      d3.select(this).append("canvas")
    }
  })

  tests.on("click", function(d) {
    console.log(d)
  })

  tests.select("div.passfail").html(function(d) {
    return d.result.passed ? "<div class='icon icon-check'></div>" : "<div class='icon icon-cancel-circled'></div>"
  })

  tests.select("div.message").html(function(d) {

    var html = '<div class="test-header">' + (d.test.name() || "") + '</div><p>'
    html += d.result.summary || ""
    html += "</p>"
    return html
  })

  var handsOnTable = this.handsOnTable
  tests.select("div.fingerprint").each(function(d) {
    if(!d.result.highlightCells || !d.result.highlightCells.length) return;
    // TODO: put this in a component/reusable chart thingy
    var width = 200;
    var height = 100;
    var cellWidth = 2;
    var cellHeight = 1;

    var rows = d.result.highlightCells.slice(0, 500);
    var cols = Object.keys(rows[0]);
    cellWidth = width / cols.length;
    height = cellHeight * rows.length;

    var canvas = d3.select(this).select("canvas").node();
    var context = canvas.getContext("2d")
    canvas.width = width;
    canvas.height = height;

    rows.forEach(function(row, i) {
      cols.forEach(function(col, j) {
        context.fillStyle = row[col] ? "#d88282" : "#ddd";
        context.fillRect(j*cellWidth, i*cellHeight, cellWidth, cellHeight)
      })
    })

    var drag = d3.behavior.drag()
      .on("drag", function(d,i){
        var mouse = d3.mouse(this);
        var x = mouse[0];
        var y = mouse[1];
        if(y < 0) y = 0;
        var row = Math.floor(y); // for now our cells are 1 pixel high so this works
        var col = Math.floor(x / width * cols.length);
        //console.log("row, col", row, col)
        handsOnTable.selectCell(row, col, row, col, true);

        /*
        grid.scrollCellIntoView(row, col)
        grid.scrollRowIntoView(row)
        grid.removeCellCssStyles("highlighted")
        */

        /*
        var column = cols[col];
        var changes = {}
        changes[row] = {}
        changes[row][column] = "changed"
        grid.addCellCssStyles("highlighted", changes)
        */
        //grid.scrollRowToTop(row)
      })
    d3.select(this).select("canvas").call(drag)
  })
}
