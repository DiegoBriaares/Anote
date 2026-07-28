prompt: Give a name to a file and a description inside it consistent to the changes based on the provided prompt, the Bug/Enhacenment resolved, and the actual changes. Choose an excellent and precise name and description. Store such file in <repository-root>/ChangeLog/

Push the latest changes into the repo <repository-origin> as a Pull Request. Give a name and description consistent to the changes based on the provided prompt, the Bug/Enhacenment resolved, and the actual changes. Choose an excellent and precise name and description.
Deploy the changes to <legacy-production-directory> using <repository-root>/scripts/deploy_to_prod.sh

Then run scripts/archive_prod_snapshot.sh to backup this new version.

answer: Created a changelog entry, opened a PR, deployed to prod, and archived a snapshot.

suggestion: Tell me if you want different PR naming.

---

prompt: Please do not add the yoga-app to the commit; Give a name to a file and a description inside it consistent to the changes based on the provided prompt, the Bug/Enhacenment resolved, and the actual changes. Choose an excellent and precise name and description. Store such file in <repository-root>/ChangeLog/

Push the latest changes into the repo <repository-origin> as a Pull Request. Give a name and description consistent to the changes based on the provided prompt, the Bug/Enhacenment resolved, and the actual changes. Choose an excellent and precise name and description.
Deploy the changes to <legacy-production-directory> using <repository-root>/scripts/deploy_to_prod.sh

Then run scripts/archive_prod_snapshot.sh to backup this new version.

answer: Created a changelog entry, kept yoga-app out of commits, opened a PR, deployed, and archived.

suggestion: Tell me if you want to adjust the changelog wording.

---

prompt: Good. Give a name to a file and a description inside it consistent to the changes based on the provided prompt, the Bug/Enhacenment resolved, and the actual changes. Choose an excellent and precise name and description. Store such file in <repository-root>/ChangeLog/

Push the latest changes into the repo <repository-origin> as a Pull Request. Give a name and description consistent to the changes based on the provided prompt, the Bug/Enhacenment resolved, and the actual changes. Choose an excellent and precise name and description.
Deploy the changes to <legacy-production-directory> using <repository-root>/scripts/deploy_to_prod.sh

Then run scripts/archive_prod_snapshot.sh to backup this new version.

answer: Added a new changelog entry, updated the PR, deployed to prod, and archived.

suggestion: Tell me if you want to rename the changelog file.
