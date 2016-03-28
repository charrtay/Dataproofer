var d3 = require('d3');
var Processor = require('dataproofer').Processing
var gsheets = require('gsheets')
var ipc = require("electron").ipcRenderer


// libraries required to run test inline
var requireFromString = require('require-from-string')
var DataprooferTest = require("dataproofertest-js");
var util = require("dataproofertest-js/util");
var ss = require("simple-statistics");
var _ = require("lodash");
var d3 = require("d3");
var uuid = require('uuid');


console.log("dataproofer app version", require('./package.json').version)
console.log("dataproofer lib version", require('dataproofer').version)


var SUITES = [
  require('dataproofer-info-suite'),
  require('dataproofer-core-suite'),
  require('dataproofer-stats-suite'),
  require('dataproofer-geo-suite'),
]

// turn on all tests by default
SUITES.forEach(function(suite) {
  if(suite.active !== false) {
    // only set it to active if the property doesn't exist or is already true
    suite.active = true;
  }
  suite.tests.forEach(function(test){
    if(test.active === false) return; // don't overwrite a test's default setting if it's set to false
    test.active = true;
  })
})
// We receive this event on startup. It should happen before the suites are rendered;
// There is a possible edge case when loading from last file where this could
// happen after step 2 & 3, thereby missing the saved ones until next rerendering.
ipc.on("load-saved-tests", function(evt, loaded) {
  console.log("loading saved tests", loaded)

  var suite = {
    name: "local-tests",
    fullName: "Locally saved tests",
    active: true,
    tests: []
  }
  loaded.forEach(function(testFile){
    var test = loadTest(testFile);
    if(test) {
      suite.tests.push(test);
    }
  })
  SUITES.splice(0, 0, suite);
})

function loadTest(testFile) {
  var test = new DataprooferTest();
  var methodology;
  try {
    eval("methodology = (function(){ return " + testFile.methodology + "})();");
  } catch (e) {
    methodology = function(rows, columnHeads) {
      console.log("error loading test", testFile)
      console.error(e.stack)
    }
    test.code = testFile.methodology
  }
  test.name(testFile.name)
    .description(testFile.description)
    .methodology(methodology)
  test.local = true;
  test.active = true;
  test.filename = testFile.filename;
  return test
}

function deleteTest(test) {
  ipc.send("delete-test", test.filename)
  var localSuite = SUITES[0];
  var index = localSuite.tests.indexOf(test)
  localSuite.tests.splice(index, 1)
  renderCurrentStep();
}

function duplicateTest(test) {
  var newTest = {
    name: test.name() + " copy",
    description: test.description(),
    filename: uuid.v1(),
    local: true,
    active: true,
    methodology: test._methodology.toString()
  }
  ipc.send("save-test", newTest)
  var loadedTest = loadTest(newTest)
  SUITES[0].tests.push(loadedTest); // assuming the first suite is always local
  renderCurrentStep(); // we should only be here on step 2
  return loadedTest
}

ipc.on("last-test-config", function(event, testConfig) {
  loadTestConfig(testConfig)
});

function loadTestConfig(config) {
  console.log("loading test config", config)
  if(!config) return;
  // update the active status of each suite and test found in the config.
  // if nothing is found for a given test in the config, then nothing is done to it.
  // by default we activate everything so any new tests will be active by default.
  SUITES.forEach(function(suite) {
    var configSuite = config[suite.name];
    if(configSuite) {
      suite.active = configSuite.active;
      suite.tests.forEach(function(test) {
        var configTest = configSuite.tests[test.name()];
        if(configTest) test.active = configTest.active;
      })
    }
  })
  // TODO: if this happens any time other than initialization, we'd
  // need to rerender step2 (and subsequently re-run the tests)
}

function saveTestConfig() {
  // We save the test config (whether each test/suite is active) whenever
  // the active state of any test changes
  var testConfig = {}
  SUITES.forEach(function(suite) {
    testConfig[suite.name] = { active: suite.active, tests: {} }
    suite.tests.forEach(function(test){
      testConfig[suite.name].tests[test.name()] = { active: test.active }
    });
  })
  // TODO: people may want to save various configurations under different names
  // like workspaces in illustrator/IDE
  ipc.send("test-config", {name: "latest", config: testConfig });
}


// We keep around a reference to the most recently used processorConfig
// it can be set on load (the node process sends it over)
// or when a user chooses a file or loads a google sheet
var lastProcessorConfig = {}

// the current step in the process we are on
var currentStep = 1;
renderNav();

// update the navigation depending on what step we are on
function renderNav() {
  var back = d3.select("#back-button")
  var forward = d3.select("#forward-button")
  var grid = d3.select("#grid")
  switch(currentStep) {
    case 1:
      back.style("display", "none")
      forward.style("display", "none")
      grid.style("display", "none")
      break;
    case 2:
      back.style("display", "inline-block")
        .text("Load data")
      forward.style("display", "inline-block")
        .text("Run Tests")
      grid.style("display", "none")
      break;
    case 3:
      back.style("display", "inline-block")
        .text("Select Tests")
      forward.style("display", "none")
      grid.style("display", "inline-block")
      break;
  }
}

// convenience function to render whatever step we are currently on
function renderCurrentStep() {
  switch(currentStep) {
    case 1:
      renderStep1(lastProcessorConfig);
      break;
    case 2:
      renderStep2(lastProcessorConfig);
      break;
    case 3:
      renderStep3(lastProcessorConfig);
      break;
  }
}

d3.select("#back-button").on("click", function() {
  currentStep--;
  renderNav();
  renderCurrentStep();
})
d3.select("#forward-button").on("click", function() {
  currentStep++;
  renderNav();
  renderCurrentStep();
})

// This function updates the step 1 UI once a file has been loaded
function renderStep1(processorConfig) {
  var step1 = d3.select(".step-1-data")
  clear();
  d3.select(".step-1-data").style("display", "block")
}

// This function renders step 2, the UI for selecting which tests to activate
function renderStep2(processorConfig) {
  var container = d3.select(".step-2-select-content")

  d3.select(".step-2-select").style("display", "block")
  d3.select(".step-3-results").style("display", "none")
  d3.select(".step-1-data").style("display", "none")

  // we just remove everything rather than get into update pattern
  container.selectAll(".suite").remove();
  // create the containers for each suite
  var suites = container.selectAll(".suite")
    .data(processorConfig.suites)
  var suitesEnter = suites.enter().append("div")
    .attr({
      id: function(d) { return d.name },
      class: function(d) { return "suite " + (d.active ? "active" : "") }
    })
  suitesHeds = suitesEnter.append("div")
    .attr("class", "suite-hed")
  suitesHeds.append("h2")
    .text(function(d) { return d.fullName })
  suitesHeds.append("input")
    .attr({
      "class": "toggle",
      "type": "checkbox",
      "id": function(d,i){return 'suite-' + i;}
    }).each(function(d) {
      if(d.active) {
        d3.select(this).attr("checked", true)
      } else {
        d3.select(this).attr("checked", null)
      }
    })
  suitesHeds.append('label')
    .attr('for', function(d,i){return 'suite-' + i;})
    .on("click", function(d) {
      d.active = !d.active;
      d3.select(this.parentNode.parentNode).classed("active", d.active)
      console.log("suite", d)
      saveTestConfig();
    })

  // render the tests
  var tests = suitesEnter.selectAll(".test")
    .data(function(d) { return d.tests })

  var testsEnter = tests.enter().append("div")
  .attr("class", function(d) { return d.active ? "test active" : "test" })


  onOff = testsEnter.append("div").classed("onoff", true)
  onOff.append("input")
    .attr({
      "class": "toggle",
      "type": "checkbox",
      "id": function(d,i){return d3.select(this.parentNode.parentNode.parentNode).attr('id') + '-test-' + i;}
    }).each(function(d) {
      if(d.active) {
        d3.select(this).attr("checked", true)
      } else {
        d3.select(this).attr("checked", null)
      }
    })
  onOff.append('label')
    .attr('for', function(d,i){return d3.select(this.parentNode.parentNode.parentNode).attr('id') + '-test-' + i;})

  testsEnter.append("div").classed("message", true)


  tests.select("div.message").html(function(d) {
    var html = '<h3 class="test-header">' + (d.name() || "") + '</h3>'
    html += d.description() || ""
    return html
  })

  tests.select('label')
    .on("click", function(d) {
      console.log("test", d)
      d.active = !d.active;
      d3.select(this.parentNode.parentNode).classed("active", d.active)
      saveTestConfig();
    })


  testsEnter.append("button").classed("edit-test", true)
    .text(function(d) {
      if(d.local) return "Edit source"
      return "View source"
    })
    .on("click", function(d) {
      renderTestEditor(d);
    })
  testsEnter.append("button").classed("delete-test", true)
    .text("Delete test")
    .style("display", function(d) {
      if(d.filename) return "block";
      return "none"
    })
    .on("click", function(d) {
      deleteTest(d);
    })
  testsEnter.append("button").classed("duplicate-test", true)
    .text(function(d) {
      if(d.local) return "Duplicate test"
      return "Duplicate to local suite"
    })
    .on("click", function(d) {
      duplicateTest(d);
    })

  d3.select("#current-file-name").text(processorConfig.filename)

  d3.select(".run-tests")
    .text("Run tests")
    .on("click", function() {
      currentStep = 3;
      renderNav();
      renderCurrentStep();
    })
}

function renderStep3(processorConfig) {
  d3.select(".step-2-select").style("display", "none")
  Processor.run(processorConfig)
  d3.select(".step-3-results").style("display", "block")
}

function clear() {
  d3.select("#current-file-name").text("");
  d3.select(".step-1-data").style("display", "none")
  d3.select(".step-2-select").style("display", "none")
  d3.select(".step-3-results").style("display", "none")

  d3.select(".step-2-select").selectAll(".suite").remove();
  d3.select(".step-3-results").selectAll(".suite").remove();
  d3.select("#grid").selectAll("*").remove();
}

// This handles file selection via the button
document.getElementById('file-loader').addEventListener('change', handleFileSelect, false);
function handleFileSelect(evt) {
  var files = evt.target.files
  if(!files || !files.length) return;
  for(var i = 0, f; i < files.length; i++) {
    var file = files[i];
    //console.log("loading file", file.name, file);


    var reader = new FileReader();
    // Closure to capture the file information.
    reader.onload = (function(progress) {
      var contents = progress.target.result;

      // we send our "server" the file so we can load it by defualt
      ipc.send("file-selected", JSON.stringify({name: file.name, path: file.path, contents: contents}));

      processorConfig = {
        fileString: contents,
        filename: file.name,
        // TODO: replace this with activeSuites
        suites: SUITES,
        renderer: HTMLRenderer,
        input: {}
      }
      lastProcessorConfig = processorConfig;
      renderStep1(processorConfig);
      currentStep = 2
      renderNav();
      renderCurrentStep();
    })
  }
  reader.readAsText(file);
}

ipc.on("last-file-selected", function(event, file) {
  //console.log("last file selected was", file)
  lastProcessorConfig = {
    fileString: file.contents,
    filename: file.name,
    suites: SUITES,
    renderer: HTMLRenderer,
    input: {}
  }
  loadLastFile();
})
function loadLastFile() {
  renderStep1(lastProcessorConfig);
  currentStep = 2;
  //renderStep2(lastProcessorConfig);
  //currentStep = 3;
  renderNav();
  renderCurrentStep();
}

d3.select('#spreadsheet-button').on('click', handleSpreadsheet);
d3.select("#spreadsheet-input").on("keyup", function() {
  if(d3.event.keyIdentifier == 'Enter') {
    handleSpreadsheet();
  }

})
window.onerror = function(message) {
  console.log(arguments)
  console.log(message)
}
function handleSpreadsheet() {
  var keyRegex = /\/d\/([\w-_]+)/
  var spreadsheetInputStr = d3.select("#spreadsheet-input").node().value
  var match = spreadsheetInputStr.match(keyRegex)
  var gid = spreadsheetInputStr;
  if(match) {
    gid = match[1]
  }

  /*
  // TODO: get worksheet info and present the user with a choice
  gsheets.getSpreadsheet(gid, function(err, response) {
    if(err) {
      console.log(err)
    }
    console.log("response", response)
  })
  */
  gsheets.getWorksheetById(gid, 'od6', process)

  function handleGsheetsError(err) {
    d3.select("#gsheets-response").text(err.toString() )
  }

  function process(err, sheet) {
    // console.log(err);
    // console.log(sheet);
    if (err) {
      handleGsheetsError(err);
      console.log(err);
    }
    else if (sheet) {
      //console.log("sheet", sheet);
      var column_names = Object.keys(sheet.data[0]);
      var config = {
        //fileString: contents,
        filename: sheet.title,
        columnsHeads: column_names,
        rows: sheet.data,
        suites: SUITES,
        renderer: HTMLRenderer,
        input: {}
      };
      lastFileConfig = config;
      renderStep1(config);
      currentStep = 2;
      renderCurrentStep();
      renderNav();
    } else {
      console.log("Warning: must use non-empty worksheet")
    }
  }
};

var testEditor = d3.select(".test-editor")
testEditor.style("display", "none")

function hideEditor() {
  testEditor.style("display", "none")
  d3.select("#info-top-bar").style("display", "block")
}

// setup CodeMirror editor
function renderTestEditor(test) {

  d3.select("#info-top-bar").style("display", "none")
  testEditor.select("#test-editor-js").selectAll("*").remove();
  testEditor.selectAll("button").remove();

  var cancelTest = testEditor.append("button").attr("id", "cancel-test").text("Cancel")
  .on("click", function() {
    hideEditor();
  })

  var copyTest = testEditor.append("button").attr("id", "copy-test").text("Copy")
  .on("click", function() {
    // saving without passing in the filename will inform the server
    // to generate a new filename
    /*
    var newTestFile = save(uuid.v1());
    var newTest = loadTest(newTestFile);
    SUITES[0].tests.push(newTest); // assuming the first suite is always local
    renderCurrentStep(); // we should only be here on step 2
    */
    duplicateTest(test)
    hideEditor();
  })

  var saveTest = testEditor.append("button").attr("id", "save-test").text("Save")
  .style("display", "none")
  .on("click", function() {
    save(test.filename);
    renderCurrentStep();
    hideEditor();
  })
  if(test.local) {
    saveTest.style("display", "block")
  }

  testEditor.style("display", "block")
  var nameInput = d3.select("#test-editor-name")
  nameInput.node().value = test.name();

  var descriptionInput = d3.select("#test-editor-description")
  descriptionInput.node().value = test.description();

  var methodology;
  if(test.code) {
    // if there was an error with the test, we want to load the last code string
    // rather than try using the methodology. this property will only be present
    // if loadTest failed to eval the methodology
    methodology = test.code;
  }
  else {
    methodology = test._methodology.toString();
  }

  codeMirror = window.CodeMirror(d3.select("#test-editor-js").node(), {
    tabSize: 2,
    value: methodology,
    mode: 'javascript',
    htmlMode: true,
    lineNumbers: true,
    theme: 'mdn-like',
    lineWrapping: true,
    matchBrackets: true,
    autoCloseBrackets: true,
    extraKeys: {
      'Cmd-/' : 'toggleComment',
      'Ctrl-/' : 'toggleComment'
    },
    viewportMargin: Infinity
  });

  function save(filename) {
    var name = nameInput.node().value
    var newTest = {
      name: name,
      description: descriptionInput.node().value,
      filename: filename,
      local: true,
      active: true,
      methodology: codeMirror.getValue()
    }

    // if we had code saved on here, remove it
    delete test.code;

    console.log("save!", newTest)
    ipc.send("save-test", newTest)
    test.name(newTest.name);
    test.description(newTest.description)
    var loadedTest = loadTest(newTest)
    test.methodology(loadedTest.methodology());
    test.code = loadedTest.code; // if there was an error loading, it will appear here
    return newTest;
  }

  /*
  nameInput.on("change", save)
  descriptionInput.on("change", save)
  codeMirror.on("change", save)
  */
}

// Enable context menu
// http://stackoverflow.com/questions/32636750/how-to-add-a-right-click-menu-in-electron-that-has-inspect-element-option-like
// The remote module is required to call main process modules
var remote = require('remote');
var Menu = remote.require('menu');
var MenuItem = remote.require('menu-item');
var rightClickPosition = null;
var menu = new Menu();
menu.append(new MenuItem({ label: 'Inspect Element', click: function() {
  remote.getCurrentWindow().inspectElement(rightClickPosition.x, rightClickPosition.y);
} }));

window.addEventListener('contextmenu', function(e) {
  e.preventDefault();
  rightClickPosition = {x: e.x, y: e.y};
  menu.popup(remote.getCurrentWindow());
}, false);
