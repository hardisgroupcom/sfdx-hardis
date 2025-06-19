
/* requires the following configuration in mkdocs.yml
extra_javascript:
  - https://cdnjs.cloudflare.com/ajax/libs/jquery/3.6.4/jquery.min.js
  - https://cdnjs.cloudflare.com/ajax/libs/jstree/3.3.12/jstree.min.js
  - javascripts/jstree-handler.js
extra_css:
  - https://cdnjs.cloudflare.com/ajax/libs/jstree/3.3.12/themes/default/style.min.css
  - https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css
*/

function countJsTreeNodes(nodes) {
  let count = 0;

  function traverse(nodeList) {
    for (const node of nodeList) {
      count++;
      if (node.children && node.children.length > 0) {
        traverse(node.children);
      }
    }
  }

  traverse(nodes);
  return count;
}

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
    const nodesNumber = countJsTreeNodes(jsonData);
    container.jstree({
      'core': {
        'data': jsonData
      },
      "plugins": [
        "search"
      ],
      'search': {
        //'show_only_matches': true,
        'case_sensitive': false
      }
    }).on('ready.jstree', function () {
      $('#jstree-container').on('click', '.jstree-anchor', function (e) {
        // Prevent the default behavior of the click (which might conflict with jsTree's event)
        e.preventDefault();
        // Get the node
        const node = $(this).closest('li');
        // Check if it's a folder (node with children) and toggle
        if (node.hasClass('jstree-open')) {
          $('#jstree-container').jstree('close_node', node);
        } else {
          $('#jstree-container').jstree('open_node', node);
        }
      });
      // Open all if there are less than 30 nodes
      if (nodesNumber < 20) {
        $('#jstree-container').jstree('open_all');
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