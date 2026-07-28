prompt: Good. Please make a list of the prompts I have gave you in this conversartion. Determine if each one corresponds
  to an enhacenment or a bug, then determine the enhacement/bug, all of the prompts related to same enhancement/bug
  would end in a same folder (ill clarify next), and group prompts related to a same issue into a same file,in such
  file the prompts would be seppared by a blank line and then a line with --- and the another blank line, sorted by
  order of appeareance (first prompt wrote appears first).Now let me clarify srchitecutre; For each bug/enhacmenet
  create a folder with a good descriptive practical name, which you will put either in <home-directory>/Desktop/
  Desarrollo/administration-management-plan-system/Prompts/Enhancements or in <repository-root>/Prompts/Bugs
  accordingly, and inside that folder a descriptive name for enhancement/bug, inside that folder put the files with a
  descriptive name of the issue the group of prompts addreses.

 Also lets not only retrieve the prompts, also the final question/sugestion you give with a brief
  essential description of the changes, for example in this last prompt the suggestion was If you want a different
  grouping or folder naming scheme, tell me the adjustments, and a bried description is: created the folders and files.
  (note that i dont want the complete report just a small description that serves as context for future prompts that
  were performed). The format to store them and linked them to the prompts is: in the file where the prompts are
  stored, for each prompt this is the format: prompt: <prompt>, and in the next line: answer: <brief description> +
  <suggestion>.

leave a blank line between prompt:<>, answer: <>, sugestion:<> in the files with the prompts.

Give a name to a file and a description inside it consistent to the changes based on the provided prompt, the Bug/Enhacenment resolved, and the actual changes. Choose an excellent and precise name and description. Store such file in <repository-root>/ChangeLog/

Push the latest changes into the repo <repository-origin> as a Pull Request. Give a name and description consistent to the changes based on the provided prompt, the Bug/Enhacenment resolved, and the actual changes. Choose an excellent and precise name and description.
Deploy the changes to <legacy-production-directory> using <repository-root>/scripts/deploy_to_prod.sh

Then run scripts/archive_prod_snapshot.sh to backup this new version.

answer: Archived prompts into enhancement folders with prompt/answer/suggestion blocks, created a ChangeLog entry for the day-events label and copy/move update, and completed PR creation plus deployment and snapshot backup.

suggestion: Let me know if you want tests or a different PR title/description, and I can adjust.

---
