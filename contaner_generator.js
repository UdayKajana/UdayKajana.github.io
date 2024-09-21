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

                                      const nameElement = document.createElement('h3');
                                          nameElement.textContent = Object.keys(jsonObject)[0];
                                              container.appendChild(nameElement);

                                                  for (const key in jsonObject) {
                                                        const value = jsonObject[key];
                                                              if (typeof value === 'object') {
                                                                      container.appendChild(createContainer(value, indentLevel + 1));
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

                                                                                                                            // Append the generated HTML to the document body
                                                                                                                              document.body.appendChild(page);
                                                                                                                              }

                                                                                                                              // Replace 'contents.json' with the actual path to your JSON file
                                                                                                                              fetch('contents.json')
                                                                                                                                .then(response => response.json())
                                                                                                                                  .then(data => createHTMLPageFromJSON(data));

