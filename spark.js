function createExpandingPage() {
      // Create the HTML elements
        const body = document.createElement('body');
          const container = document.createElement('div');
            container.className = 'container';
              container.textContent = 'Spark';

                const coreConceptsContent = document.createElement('div');
                  coreConceptsContent.className = 'content';
                    coreConceptsContent.id = 'coreConcepts';
                      coreConceptsContent.textContent = 'Core Concepts';

                        const advancedConceptsContent = document.createElement('div');
                          advancedConceptsContent.className = 'content';
                            advancedConceptsContent.id = 'advancedConcepts';
                              advancedConceptsContent.textContent = 'Advanced Concepts';

                                // Create the core concepts list
                                  const coreConceptsList = document.createElement('ul');
                                    // Add your core concept items here
                                      coreConceptsList.innerHTML = `
                                          <li>Item 1</li>
                                              <li>Item 2</li>
                                                  `;
                                                    coreConceptsContent.appendChild(coreConceptsList);

                                                      // Create the advanced concepts list
                                                        const advancedConceptsList = document.createElement('ul');
                                                          // Add your advanced concept items here
                                                            advancedConceptsList.innerHTML = `
                                                                <li>Item 1</li>
                                                                    <li>Item 2</li>
                                                                        `;
                                                                          advancedConceptsContent.appendChild(advancedConceptsList);

                                                                            // Append the elements to the body
                                                                              body.appendChild(container);
                                                                                body.appendChild(coreConceptsContent);
                                                                                  body.appendChild(advancedConceptsContent);

                                                                                    // Add event listener to the container to expand content
                                                                                      container.addEventListener('click', () => {
                                                                                          coreConceptsContent.style.display = 'block';
                                                                                              advancedConceptsContent.style.display = 'block';
                                                                                                });

                                                                                                  // Append the body to the document
                                                                                                    document.body.appendChild(body);
                                                                                                    }

                                                                                                    // Call the function to create the page
                                                                                                    createExpandingPage();
                                                                                  
