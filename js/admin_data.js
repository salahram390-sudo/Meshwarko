import adminData from "../assets/egypt_admin.json" assert { type: "json" };
export async function loadEgyptAdmin() {
  return adminData;
}

export function fillSelect(selectEl, items, placeholder = "اختر") {
  selectEl.innerHTML = "";
  for (const it of items) {
    const opt = document.createElement("option");
    opt.value = it;
    opt.textContent = it;
    selectEl.appendChild(opt);
  }
  if (placeholder) {
    // nothing: keep direct list for mobile
  }
}

export function renderVehicleGrid(rootEl, vehicleTypes, selectedId, onSelect) {
  rootEl.innerHTML = "";
  vehicleTypes.forEach(v => {
    const div = document.createElement("div");
    div.className = "vehicle" + (v.id === selectedId ? " active" : "");
    div.innerHTML = `<div class="ico">${v.icon}</div><div class="nm">${v.name}</div>`;
    div.onclick = () => onSelect(v.id);
    rootEl.appendChild(div);
  });
}

export function setActiveVehicle(rootEl, id) {
  rootEl.querySelectorAll(".vehicle").forEach((el, idx) => {
    const isActive = el.classList.contains("active");
  });
}
