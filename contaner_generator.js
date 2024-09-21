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

        const nameElement = document.createElement('h3');
        const containerName = Object.keys(jsonObject)[0];
        nameElement.textContent = containerName;
        container.appendChild(nameElement);

        for (const key in jsonObject) {
            const value = jsonObject[key];
            if (typeof value === 'object') {
                const subContainer = createContainer(value, indentLevel + 1);
                subContainer.classList.add('expandable'); // Add class for sub-containers

                // Click event listener for expand/collapse
                nameElement.addEventListener('click', () => {
                    subContainer.classList.toggle('expanded');
                });

                container.appendChild(subContainer);
            } else {
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

