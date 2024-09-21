function createHTMLPageFromJSON(json) {
    const page = document.createElement('html');
    const head = document.createElement('head');
    const title = document.createElement('title');
    title.textContent = 'JSON to HTML';
    head.appendChild(title);
    page.appendChild(head);

    const body = document.createElement('body');
    page.appendChild(body);

    function createContainer(jsonObject, indentLevel) {
        const container = document.createElement('div');
        container.className = 'container';
        container.style.marginLeft = `${indentLevel * 20}px`; // Adjust indentation as needed
        container.style.border = '1px solid #ddd'; // Add border

        // Filter for objects (tags with nested JSON)
        const filteredObject = Object.entries(jsonObject).find(([key, value]) => typeof value === 'object');

        if (filteredObject) {
            const [tagName, nestedObject] = filteredObject;
            const nameElement = document.createElement('h3');
            nameElement.textContent = tagName;
            container.appendChild(nameElement);

            const toggleButton = document.createElement('button');
            toggleButton.textContent = '+'; // Initially collapsed
            container.appendChild(toggleButton);

            const detailsElement = document.createElement('details');
            detailsElement.classList.add('details'); // Initially hidden
            container.appendChild(detailsElement);

            function createSubContainer(nestedObject, subIndentLevel) {
                const subContainer = document.createElement('div');
                subContainer.className = 'sub-container';
                subContainer.style.marginLeft = `${subIndentLevel * 20}px`;

                for (const key in nestedObject) {
                    const value = nestedObject[key];
                    if (typeof value === 'object') {
                        const subSubContainer = createSubContainer(value, subIndentLevel + 1);
                        subContainer.appendChild(subSubContainer);
                    } else {
                        const element = document.createElement('p');
                        element.textContent = `${key}: ${value}`;
                        subContainer.appendChild(element);
                    }
                }

                return subContainer;
            }

            const subContainer = createSubContainer(nestedObject, indentLevel + 1);
            detailsElement.appendChild(subContainer);

            toggleButton.addEventListener('click', () => {
                detailsElement.classList.toggle('expanded');
                toggleButton.textContent = detailsElement.classList.contains('expanded') ? '-' : '+';
            });
        } else {
            // Handle cases where the top level doesn't have nested JSON (only tags)
            for (const key in jsonObject) {
                const value = jsonObject[key];
                const element = document.createElement('p');
                element.textContent = `${key}: ${value}`;
                container.appendChild(element);
            }
        }

        return container;
    }

    const rootContainer = createContainer(json, 0);
    body.appendChild(rootContainer);

    document.body.appendChild(page);
}

// Replace 'contents.json' with the actual path to your JSON file
fetch('contents.json')
    .then(response => response.json())
    .then(data => createHTMLPageFromJSON(data));

