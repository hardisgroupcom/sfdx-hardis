
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
        'dblclick_toggle': false,
        'data': jsonData
      },
      "plugins": [
        "search"
      ],
      'search': {
        //'show_only_matches': true,
        'case_sensitive': false
      }
    });

    // Add search button
    if (container?.[0]?.parentNode) {
      // Create the input element
      const searchInput = document.createElement('input');
      searchInput.type = 'text';
      searchInput.id = 'jstree-search';
      searchInput.placeholder = 'Input items to find';
      searchInput.style.marginBottom = '1em'; // Optional spacing
      // Insert it before the jstree container
      container[0].parentNode.insertBefore(searchInput, container[0]);

      // Perform search
      let to = false;
      $('#jstree-search').on('input', function () {
        if (to) clearTimeout(to);
        to = setTimeout(function () {
          const searchValue = $('#jstree-search').val();
          $('#jstree-container').jstree(true).search(searchValue);
        }, 250); // debounce for smoother UX
      });
    }

  } catch (err) {
    console.error('Failed to load JSON file:', jsonPath, err);
  }

});