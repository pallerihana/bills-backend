require('dotenv').config();
const mongoose = require('mongoose'), bcrypt = require('bcryptjs');
const User = require('./models/User'), Employee = require('./models/Employee');
const { prepare } = require('./utils/employeeSeed');

// ===== COMPANY EMPLOYEES: add or edit rows here, then run `node seed.js` (safe to run again and again) =====
// employeeId is the unique key. Rows missing from this list are NEVER deleted.
// To retire someone, keep their row and add  active: false
const EMPLOYEES = [
  { employeeId: 'CT0811', name: 'Heena Afrin', email: 'aheena@codetantra.in' },
  { employeeId: 'CT0842', name: 'Ambika Jyothi Devana', email: 'ambikad@codetantra.in' },
  { employeeId: 'CT0703', name: 'Anil Palle', email: 'anilp@codetantra.in' },
  { employeeId: 'CT0843', name: 'Bhargavi Mohana Maddu', email: 'bhargavim@codetantra.in' },
  { employeeId: 'CT0759', name: 'Fazal Shaik', email: 'fazals@codetantra.in' },
  { employeeId: 'CT0611', name: 'Lakshmi Gayathri Gunti', email: 'gayathrig@codetantra.in' },
  { employeeId: 'CT0773', name: 'Sai Kamakshi Harshitha Dammavalam', email: 'harshithad@codetantra.in' },
  { employeeId: 'CT0434', name: 'Manohar Chandaluri', email: 'manoharc@codetantra.in' },
  { employeeId: 'CT0840', name: 'Niharika Meda', email: 'niharikam@codetantra.in' },
  { employeeId: 'CT0768', name: 'Preethi Padmavathi Taluchuri', email: 'padmavathit@codetantra.in' },
  { employeeId: 'CT0901', name: 'Paliki Rohini', email: 'rohinip@codetantra.in' },
  { employeeId: 'CT0836', name: 'Sanjit Pandey', email: 'sanjitp@codetantra.in' },
  { employeeId: 'CT0772', name: 'Swapna Duggi', email: 'swapnad@codetantra.in' },
  { employeeId: 'CT0398', name: 'Anusha Punnapu', email: 'anushap@codetantra.in' },
  { employeeId: 'CT0845', name: 'Durga Deepika Vutukuri', email: 'deepikav@codetantra.in' },
  { employeeId: 'CT0904', name: 'Bolagani Kumar Raja', email: 'kumarrajab@codetantra.in' },
  { employeeId: 'CT0844', name: 'Lavanya Lahari Mallela', email: 'laharim@codetantra.in' },
  { employeeId: 'CT0846', name: 'Lakshmi Prasanna Domathoti', email: 'lprasanna@codetantra.in' },
  { employeeId: 'CT0702', name: 'Parvez Shaik', email: 'parvezs@codetantra.in' },
  { employeeId: 'CT0849', name: 'Ramya Pasupuleti', email: 'ramyap@codetantra.in' },
  { employeeId: 'CT0924', name: 'R Eshwar Reddy', email: 'reshwar@codetantra.in' },
  { employeeId: 'CT0865', name: 'Shaheena Mohammad', email: 'shaheenam@codetantra.in' },
  { employeeId: 'CT0919', name: 'J Shreya', email: 'shreyaj@codetantra.in' },
  { employeeId: 'CT0862', name: 'Sirish Yenuganti', email: 'sirishy@codetantra.in' },
  { employeeId: 'CT0717', name: 'Sivaji Laveti', email: 'sivajil@codetantra.in' },
  { employeeId: 'CT0804', name: 'Kumar Chaitanya Chakka', email: 'chaitanyac@codetantra.in' },
  { employeeId: 'CT0722', name: 'Durga Sai Rama Lakshmi Avvaru', email: 'durgalakshmia@codetantra.in' },
  { employeeId: 'CT0871', name: 'Shaik Habibulla', email: 'habibullas@codetantra.in' },
  { employeeId: 'CT0724', name: 'Swathi Immadisetty', email: 'iswathi@codetantra.in' },
  { employeeId: 'CT0870', name: 'Kalaga Madhu', email: 'kmadhu@codetantra.in' },
  { employeeId: 'CT0918', name: 'K Leela Kumari', email: 'leelakumarik@codetantra.in' },
  { employeeId: 'CT0905', name: 'Dondleti Rajitha', email: 'rajithad@codetantra.in' },
  { employeeId: 'CT0820', name: 'Umme Salma Shaik', email: 'salmau@codetantra.in' },
  { employeeId: 'CT0549', name: 'Shareef Nagarathugari', email: 'shareefn@codetantra.in' },
  { employeeId: 'CT0907', name: 'Allam Bhavaswitha', email: 'abhavaswitha@codetantra.in' },
  { employeeId: 'CT0875', name: 'Kothuri Udaya Bhanu Anjani Devi', email: 'anjanidevi@codetantra.in' },
  { employeeId: 'CT0834', name: 'Ashritha Paladugu', email: 'ashrithap@codetantra.in' },
  { employeeId: 'CT0694', name: 'Asifa Banu Syed', email: 'asifas@codetantra.in' },
  { employeeId: 'CT0922', name: 'K Bhavavi', email: 'bhavanik@codetantra.in' },
  { employeeId: 'CT0850', name: 'Akhil Kumar Guntupalli', email: 'gakhil@codetantra.in' },
  { employeeId: 'CT0903', name: 'Mahesh Kumar Pothu', email: 'pmahesh@codetantra.in' },
  { employeeId: 'CT0803', name: 'Lakshmi Prasanna Bainaboina', email: 'prasannab@codetantra.in' },
  { employeeId: 'CT0807', name: 'Pavan Rajeev Reddy Sanampudi', email: 'rajeevs@codetantra.in' },
  { employeeId: 'CT0604', name: 'Renuka Muvvala', email: 'renukam@codetantra.in' },
  { employeeId: 'CT0928', name: 'B Sisindri', email: 'sisindrib@codetantra.in' },
  { employeeId: 'CT0753', name: 'Divyanjali Bhimavarapu', email: 'divyanjalib@codetantra.in' },
  { employeeId: 'CT0732', name: 'Thippa Harshavardhan', email: 'harshavardhant@codetantra.in' },
  { employeeId: 'CT0927', name: 'T Harshitha', email: 'harshithat@codetantra.in' },
  { employeeId: 'CT0926', name: 'S Jhansi', email: 'jhansis@codetantra.in' },
  { employeeId: 'CT0757', name: 'Karthik Muniganti', email: 'karthikm@codetantra.in' },
  { employeeId: 'CT0648', name: 'Krishna Deepika Purimetla', email: 'krishnap@codetantra.in' },
  { employeeId: 'CT0771', name: 'Nagamani Segalla', email: 'nagamans@codetantra.in' },
  { employeeId: 'CT0821', name: 'Navya Ganta', email: 'navyag@codetantra.in' },
  { employeeId: 'CT0730', name: 'Revathi Ganesana', email: 'revathig@codetantra.in' },
  { employeeId: 'CT0530', name: 'Shaik Sadhik', email: 'sadhiks@codetantra.in' },
  { employeeId: 'CT0651', name: 'Anantha Venkata Sai Lakshmi Grandhi', email: 'ananthag@codetantra.in' },
  { employeeId: 'CT0814', name: 'Vaishnavi Boddu', email: 'bvaishnavi@codetantra.in' },
  { employeeId: 'CT0880', name: 'K Mounika', email: 'mounikak@codetantra.in' },
  { employeeId: 'CT0906', name: 'Pasupuleti Dunde Neelima', email: 'neelimap@codetantra.in' },
  { employeeId: 'CT0876', name: 'Vennapusa Pavitra', email: 'pavitrav@codetantra.in' },
  { employeeId: 'CT0874', name: 'Chinni Sri Lakshmi Prasanna', email: 'prasannac@codetantra.in' },
  { employeeId: 'CT0619', name: 'Sambasiva Rao Vantipuli', email: 'sambasivav@codetantra.in' },
  { employeeId: 'CT0764', name: 'Abhinai Gonuguntla', email: 'abhinaig@codetantra.in' },
  { employeeId: 'CT0656', name: 'V S N S P Sai Mani Durga Maddi', email: 'durgam@codetantra.in' },
  { employeeId: 'CT0755', name: 'Jathin Kumar Chilamakuri', email: 'jathinc@codetantra.in' },
  { employeeId: 'CT0754', name: 'Mahesh Gosala', email: 'maheshg@codetantra.in' },
  { employeeId: 'CT0657', name: 'Navya Thota', email: 'navyat@codetantra.in' },
  { employeeId: 'CT0848', name: 'Venkata Pranav Kumar Rekhapalli', email: 'pranavr@codetantra.in' },
  { employeeId: 'CT0863', name: 'Pathapati Lakshmi Prasanna', email: 'prasannap@codetantra.in' },
  { employeeId: 'CT0601', name: 'Pujitha Pallagorla', email: 'pujithap@codetantra.in' },
  { employeeId: 'CT0851', name: 'Tejanath Narne', email: 'tejanathn@codetantra.in' },
  { employeeId: 'CT0873', name: 'Yakkala Hema devi', email: 'hemadevi@codetantra.in' },
  { employeeId: 'CT0709', name: 'Srirama Lahari', email: 'laharis@codetantra.in' },
  { employeeId: 'CT0929', name: 'K Mahendra', email: 'mahendrak@codetantra.in' },
  { employeeId: 'CT0868', name: 'Naru Manikanta Reddy', email: 'manikantan@codetantra.in' },
  { employeeId: 'CT0825', name: 'Siva Parvathi Rajala', email: 'parvathir@codetantra.in' },
  { employeeId: 'CT0925', name: 'P Guru Venkata Sai Kumar', email: 'saikumarp@codetantra.in' },
  { employeeId: 'CT0877', name: 'Vura Divya Venkata Sai Lakshmi', email: 'sailakshmi@codetantra.in' },
  { employeeId: 'CT0629', name: 'Sowmya Sri Kollu', email: 'sowmyak@codetantra.in' },
  { employeeId: 'CT0839', name: 'Surya Teja Jagarlamudi', email: 'suryatejaj@codetantra.in' },
  { employeeId: 'CT0817', name: 'Varalakshmi Singamsetty', email: 'varalakshmis@codetantra.in' },
  { employeeId: 'CT0872', name: 'Degala Venkata Gopi', email: 'venkatagopi@codetantra.in' },
  { employeeId: 'CT0923', name: 'Ch Gayatri', email: 'gayatric@codetantra.in' },
  { employeeId: 'CT0931', name: 'G Mahesh', email: 'gmahesh@codetantra.in' },
  { employeeId: 'CT0921', name: 'G Harika', email: 'harikag@codetantra.in' },
  { employeeId: 'CT0978', name: 'Kavya Sri Manchikanti', email: 'kavyasrim@codetantra.in' },
  { employeeId: 'CT0962', name: 'Jhnana Pradeep Reddy Kypa', email: 'pradeepk@codetantra.in' },
  { employeeId: 'CT0930', name: 'N Sai Nikhil', email: 'sainikhiln@codetantra.in' },
  { employeeId: 'CT0920', name: 'G Srikanth Reddy', email: 'srikanthg@codetantra.in' },
  { employeeId: 'CT0564', name: 'Ajay Manjunath Ozili', email: 'ajayo@codetantra.in' },
  { employeeId: 'CT0716', name: 'Babu Gollaprolu', email: 'babug@codetantra.in' },
  { employeeId: 'CT0541', name: 'Basheeruddin Shaik', email: 'basheeruddins@codetantra.in' },
  { employeeId: 'CT0729', name: 'Farzaan Shaik', email: 'farzaans@codetantra.in' },
  { employeeId: 'CT0497', name: 'Jahnavi Potharlanka', email: 'jahnavip@codetantra.in' },
  { employeeId: 'CT0731', name: 'Kusuma Kumari Uppu', email: 'kusumau@codetantra.in' },
  { employeeId: 'CT0517', name: 'Meghana Moparthy', email: 'meghanam@codetantra.in' },
  { employeeId: 'CT0769', name: 'Venkata Karthik Manne', email: 'mkarthik@codetantra.in' },
  { employeeId: 'CT0386', name: 'Prasanthi Thathireddy', email: 'prasanthit@codetantra.in' },
  { employeeId: 'CT0427', name: 'Sai Prasanna Rahul Saggurthi', email: 'rahuls@codetantra.in' },
  { employeeId: 'CT0556', name: 'Vamsi Manda', email: 'vamsim@codetantra.in' },
  { employeeId: 'CT0828', name: 'Ashwitha Chidirala', email: 'ashwithac@codetantra.in' },
  { employeeId: 'CT0861', name: 'Mothe Ashwitha', email: 'ashwitham@codetantra.in' },
  { employeeId: 'CT0866', name: 'Bhavana Thanneru', email: 'bhavanat@codetantra.in' },
  { employeeId: 'CT0390', name: 'Dharan Kumar Poojari', email: 'dharankumarp@codetantra.in' },
  { employeeId: 'CT0767', name: 'Hemanthreddy Polimera', email: 'hemanthreddyp@codetantra.in' },
  { employeeId: 'CT0900', name: 'Lokesh Kumar Dasari', email: 'lokeshd@codetantra.in' },
  { employeeId: 'CT0452', name: 'Naga Sai Revanth Emadabathuni', email: 'nagasairevanthe@codetantra.in' },
  { employeeId: 'CT0835', name: 'Naga Pranathi Maturi', email: 'pranathim@codetantra.in' },
  { employeeId: 'CT0829', name: 'Sajida Tharunam Syed', email: 'sajidas@codetantra.in' },
  { employeeId: 'CT0588', name: 'Sivakumar Manimela', email: 'sivakumarm@codetantra.in' },
  { employeeId: 'CT0864', name: 'GOBIDESI SRIHARI', email: 'sriharig@codetantra.in' },
  { employeeId: 'CT0711', name: 'Gayathri Puja Merugumilli', email: 'gayathrim@codetantra.in' },
  { employeeId: 'CT0770', name: 'Venkata Harsha Vardhan Patapanjula', email: 'harshap@codetantra.in' },
  { employeeId: 'CT0567', name: 'Jyothsna Guddinti', email: 'jyothsnag@codetantra.in' },
  { employeeId: 'CT0939', name: 'Manikanta Pokala', email: 'manikantap@codetantra.in' },
  { employeeId: 'CT0697', name: 'Navya Sree Pedumajji', email: 'navyap@codetantra.in' },
  { employeeId: 'CT0616', name: 'Sravanthi Bejjam', email: 'sravanthib@codetantra.in' },
  { employeeId: 'CT0565', name: 'Sukanya Bollepogu', email: 'sukanyab@codetantra.in' },
  { employeeId: 'CTNA', name: 'Suresh Kakani', email: 'sureshk@codetantra.in' },
  { employeeId: 'CT0917', name: 'K Vanaja', email: 'vanajak@codetantra.in' },
  { employeeId: 'CT0435', name: 'Durga Prasad Yarramsetti', email: 'durgaprasady@codetantra.in' },
  { employeeId: 'CT0867', name: 'Janiya jamgin Shaik', email: 'janiyajamgin@codetantra.in' },
  { employeeId: 'CT0881', name: 'C Lavanya', email: 'lavanyac@codetantra.in' },
  { employeeId: 'CT0790', name: 'Lakshmi Narayana Balaiah', email: 'narayanab@codetantra.in' },
  { employeeId: 'CT0598', name: 'Nikhitha Vallabhapurapu', email: 'nikhithav@codetantra.in' },
  { employeeId: 'CT0831', name: 'Shiva Kumar Kunur', email: 'shivak@codetantra.in' },
  { employeeId: 'CT0440', name: 'Susruthi Kanaparthi', email: 'susruthik@codetantra.in' },
  { employeeId: 'CT0869', name: 'Vaishnavi Thadavarthi', email: 'vaishnavit@codetantra.in' },
  { employeeId: 'CT0878', name: 'Varsha Chilukamari', email: 'varshac@codetantra.in' },
  { employeeId: 'CT0826', name: 'Kunchala Yaswanthi', email: 'yaswanthik@codetantra.in' },
  { employeeId: 'CT0307', name: 'Mani Sampath', email: 'sampathp@codetantra.in' },
  { employeeId: 'CT0308', name: 'Mani Kanta', email: 'manikanta@codetantra.in' },
  { employeeId: 'CT0336', name: 'Ujwal Kumar Yallamraju', email: 'ujwalk@codetantra.in' },
  { employeeId: 'CT0774', name: 'Nagaraju', email: 'nagarajut@codetantra.in' },
  { employeeId: 'CT0317', name: 'Karan A', email: 'akaran@codetantra.in' },
  { employeeId: 'CT0305', name: 'Rahul Tayade', email: 'rahult@codetantra.in' },
  { employeeId: 'CT0790', name: 'Lakshmi Narayana Balaiah', email: 'narayanab@codetantra.in' },
  { employeeId: 'CT0182', name: 'Jagandeep Sidhu', email: 'jagandeep@codetantra.in' },
  { employeeId: 'CT0365', name: 'Venkata Gopi Harinath K', email: 'harinath@codetantra.in' },
  { employeeId: 'CT0375', name: 'Sri Ram Prasad Adusumilli', email: 'sriramprasad@codetantra.in' },
  { employeeId: 'CT0289', name: 'Murahari D', email: 'murahari@codetantra.in' },
  { employeeId: 'CT0621', name: 'Vinay Sai Sanath Reddy', email: 'sanath@codetantra.in' },

];

(async () => {
  await mongoose.connect(process.env.MONGO_URI);

  // Admin login (unchanged): node seed.js "Name" email password
  const [name, email, password] = process.argv.slice(2);
  if (name && email && password) {
    await User.findOneAndUpdate({ email: email.toLowerCase().trim() }, { name, password: await bcrypt.hash(password, 10) }, { upsert: true });
    console.log('Admin saved:', email);
  }

  const { ok, warnings } = prepare(EMPLOYEES);
  warnings.forEach(w => console.warn('WARNING:', w));
  if (ok.length) {
    const ops = ok.map(r => {
      const update = { $set: { name: r.name, email: r.email } };
      if (typeof r.active === 'boolean') update.$set.active = r.active; else update.$setOnInsert = { active: true }; // never re-activates someone you deactivated
      return { updateOne: { filter: { employeeId: r.employeeId }, update, upsert: true } };
    });
    const res = await Employee.bulkWrite(ops, { ordered: false });
    console.log(`Employees: ${res.upsertedCount} added, ${res.modifiedCount} updated, ${res.matchedCount - res.modifiedCount} unchanged`);
  }
  console.log('Total employees in database:', await Employee.countDocuments());
  process.exit();
})().catch(e => { console.error(e.message); process.exit(1); });