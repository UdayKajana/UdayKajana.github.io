const jsonExplorer = document.getElementById('json-explorer');

// Load JSON data from contents.json (assuming this file is in the same directory)
fetch('contents.json')
  .then(response => response.json())
  .then(jsonData => {
    // Function to recursively build the JSON structure
    function buildJsonStructure(data, parentElement) {
      for (const key in data) {
        const keyElement = document.createElement('div');
        keyElement.classList.add('json-key');

        // If it's the first element (no key), use "start" as the key
        const displayKey = key === undefined ? 'start' : key;
        keyElement.textContent = `${displayKey}:`;

        // Add click event listener to expand/collapse value
        keyElement.addEventListener('click', () => {
          const valueElement = keyElement.nextElementSibling;
          valueElement.style.display = valueElement.style.display === 'none' ? 'block' : 'none';
        });

        parentElement.appendChild(keyElement);

        const valueElement = document.createElement('div');
        valueElement.classList.add('json-value');

        // Check if value is an array or object
        if (Array.isArray(data[key])) {
          const arrayContainer = document.createElement('div');
          valueElement.appendChild(arrayContainer);

          // Loop through array elements and recursively build structure
          data[key].forEach((item, index) => {
            const arrayItem = document.createElement('div');
            arrayItem.classList.add('json-array-item');
            buildJsonStructure(item, arrayItem);
            arrayContainer.appendChild(arrayItem);
          });
        } else if (typeof data[key] === 'object') {
          // Recursively build structure for objects
          buildJsonStructure(data[key], valueElement);
        } else {
          // Simple key-value pair
          valueElement.textContent = data[key];
        }

        parentElement.appendChild(valueElement);
      }
    }

    // Start building the JSON structure
    buildJsonStructure(jsonData, jsonExplorer);
  })
  .catch(error => console.error('Error loading JSON:', error));