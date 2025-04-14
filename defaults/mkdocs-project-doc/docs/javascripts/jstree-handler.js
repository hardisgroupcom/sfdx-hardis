
/* requires the following configuration in mkdocs.yml
extra_javascript:
  - https://cdnjs.cloudflare.com/ajax/libs/jquery/3.6.4/jquery.min.js
  - https://cdnjs.cloudflare.com/ajax/libs/jstree/3.3.12/jstree.min.js
  - javascripts/jstree-handler.js
extra_css:
  - https://cdnjs.cloudflare.com/ajax/libs/jstree/3.3.12/themes/default/style.min.css
  - https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css
*/
document$.subscribe(async () => {
  // Initialize jstree with some sample data
  const container = $('#jstree-container');
  if (!container || container.length === 0) {
    return; // Ensure the container exists before initializing
  }

  const pathParts = window.location.pathname.split('/').filter(Boolean);

  let section = "";
  let name = "";
  if (pathParts.length < 2) {
    section = "root";
    name = pathParts.slice(-1);
  }
  else {
    [section, name] = pathParts.slice(-2); // Get last two segments
  }
  const jsonPath = `/json/${section}-${name}.json`;

  try {
    const response = await fetch(jsonPath);
    if (!response.ok) {
      throw new Error(`HTTP error !  Status: ${response.status}`);
    }
    const jsonData = await response.json();
    container.jstree({
      'core': {
        'data': jsonData
      },
      "plugins": [
        "search",
        "state",
        "wholerow"
      ]
    });

  } catch (err) {
    console.error('Failed to load JSON file:', jsonPath, err);
  }

});